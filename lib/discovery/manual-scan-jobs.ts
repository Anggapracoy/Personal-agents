import { and, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { getDb } from "../../db";
import { manualScanJobs } from "../../db/schema";

export type ManualScanStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

// A healthy Inngest event normally starts within seconds. Polling clients may
// claim and resend an event after this delay; duplicate runs are harmless
// because the worker is serialized per owner and skips completed jobs.
export const MANUAL_SCAN_REDISPATCH_AFTER_MS = 30_000;
export const MANUAL_SCAN_QUEUE_TIMEOUT_MS = 5 * 60_000;
export const MANUAL_SCAN_RUNNING_TIMEOUT_MS = 20 * 60_000;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function publicJob(row: typeof manualScanJobs.$inferSelect) {
  return {
    id: row.id,
    status: row.status as ManualScanStatus,
    result: row.result,
    error: row.lastError,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function enqueueManualScan(input: {
  ownerEmail: string;
  forceFullScan?: boolean;
  userTimeZone?: string;
  deviceCalendarEvents?: Record<string, unknown>[];
}) {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const db = getDb();
  const [created] = await db.insert(manualScanJobs).values({
    ownerEmail,
    activeKey: ownerEmail,
    status: "queued",
    forceFullScan: input.forceFullScan === true,
    userTimeZone: input.userTimeZone?.trim().slice(0, 100) || "UTC",
    deviceCalendarEvents: (input.deviceCalendarEvents ?? []).slice(0, 500),
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing({ target: manualScanJobs.activeKey }).returning();
  if (created) return { job: publicJob(created), created: true };
  const [active] = await db.select().from(manualScanJobs).where(and(
    eq(manualScanJobs.ownerEmail, ownerEmail),
    inArray(manualScanJobs.status, ["queued", "running"]),
  )).orderBy(desc(manualScanJobs.createdAt)).limit(1);
  if (!active) throw new Error("The active scan could not be recovered.");
  return { job: publicJob(active), created: false };
}

export async function getManualScanJob(ownerEmailInput: string, jobId: string) {
  const [row] = await getDb().select().from(manualScanJobs).where(and(
    eq(manualScanJobs.ownerEmail, normalizeEmail(ownerEmailInput)),
    eq(manualScanJobs.id, jobId),
  )).limit(1);
  return row ? publicJob(row) : null;
}

export async function getLatestManualScanJob(ownerEmailInput: string) {
  const [row] = await getDb().select().from(manualScanJobs)
    .where(eq(manualScanJobs.ownerEmail, normalizeEmail(ownerEmailInput)))
    .orderBy(desc(manualScanJobs.createdAt)).limit(1);
  return row ? publicJob(row) : null;
}

export async function getManualScanJobForWorker(jobId: string, ownerEmailInput: string) {
  const [row] = await getDb().select().from(manualScanJobs).where(and(
    eq(manualScanJobs.id, jobId),
    eq(manualScanJobs.ownerEmail, normalizeEmail(ownerEmailInput)),
  )).limit(1);
  return row ?? null;
}

export async function markManualScanRunning(jobId: string) {
  const [started] = await getDb().update(manualScanJobs).set({
    status: "running",
    startedAt: new Date(),
    lastError: null,
    updatedAt: new Date(),
  }).where(and(
    eq(manualScanJobs.id, jobId),
    eq(manualScanJobs.status, "queued"),
  )).returning({ id: manualScanJobs.id });
  return Boolean(started);
}

export async function cancelManualScan(ownerEmailInput: string, jobId: string) {
  const now = new Date();
  const [cancelled] = await getDb().update(manualScanJobs).set({
    status: "cancelled",
    activeKey: null,
    lastError: null,
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(manualScanJobs.ownerEmail, normalizeEmail(ownerEmailInput)),
    eq(manualScanJobs.id, jobId),
    inArray(manualScanJobs.status, ["queued", "running"]),
  )).returning();
  if (cancelled) return { job: publicJob(cancelled), cancelled: true };
  return { job: await getManualScanJob(ownerEmailInput, jobId), cancelled: false };
}

export async function claimQueuedManualScanForRedispatch(jobId: string) {
  const now = new Date();
  const [claimed] = await getDb().update(manualScanJobs).set({
    updatedAt: now,
  }).where(and(
    eq(manualScanJobs.id, jobId),
    eq(manualScanJobs.status, "queued"),
    lt(manualScanJobs.updatedAt, new Date(now.getTime() - MANUAL_SCAN_REDISPATCH_AFTER_MS)),
    // Do not keep redispatching forever if the worker is absent or its trigger
    // was never registered. The expiry path below will release activeKey.
    gt(manualScanJobs.createdAt, new Date(now.getTime() - MANUAL_SCAN_QUEUE_TIMEOUT_MS)),
  )).returning({ id: manualScanJobs.id });
  return Boolean(claimed);
}

export async function failExpiredManualScan(jobId: string) {
  const now = new Date();
  const [failed] = await getDb().update(manualScanJobs).set({
    status: "failed",
    activeKey: null,
    lastError: "The background worker did not start or finish in time. Please try the scan again.",
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(manualScanJobs.id, jobId),
    or(
      and(
        eq(manualScanJobs.status, "queued"),
        lt(manualScanJobs.createdAt, new Date(now.getTime() - MANUAL_SCAN_QUEUE_TIMEOUT_MS)),
      ),
      and(
        eq(manualScanJobs.status, "running"),
        lt(manualScanJobs.startedAt, new Date(now.getTime() - MANUAL_SCAN_RUNNING_TIMEOUT_MS)),
      ),
    ),
  )).returning({ id: manualScanJobs.id });
  return Boolean(failed);
}

export async function completeManualScan(jobId: string, result: Record<string, unknown>) {
  await getDb().update(manualScanJobs).set({
    status: "completed",
    activeKey: null,
    result,
    lastError: null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(manualScanJobs.id, jobId),
    eq(manualScanJobs.status, "running"),
  ));
}

export async function failManualScan(jobId: string, error: unknown) {
  await getDb().update(manualScanJobs).set({
    status: "failed",
    activeKey: null,
    lastError: error instanceof Error ? error.message : String(error),
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(manualScanJobs.id, jobId),
    inArray(manualScanJobs.status, ["queued", "running"]),
  ));
}
