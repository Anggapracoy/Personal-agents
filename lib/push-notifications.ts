import { isGenericCompletionNotification } from "./schedules/notification-content";
import { characterIndexFor } from "./conversation-character";
import { messagePreview } from "./message-preview";
import { createHash, createPrivateKey, sign } from "node:crypto";
import http2 from "node:http2";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { connectedGoogleAccounts, pushDeviceTokens, pushNotificationJobs } from "../db/schema";
import type { Decision } from "./types";

export type PushEnvironment = "production" | "sandbox";

type ApnsConfiguration = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
};

type DeliveryResult = {
  status: number;
  reason?: string;
};

let cachedAuthorization: { value: string; createdAt: number; fingerprint: string } | null = null;
const RUN_ATTENTION_PREFIX = "run-attention:";
/** Recognize and retire old queued bundles; new publishers never create them. */
const PROACTIVE_BUNDLE_PREFIX = "proactive-bundle:";
const RUN_COMPLETION_PREFIX = "run-completed:";
const GOOGLE_RECONNECT_PREFIX = "google-reconnect:";

export function googleReconnectNotificationId(connectionId: string, disconnectedAt: Date) {
  return `${GOOGLE_RECONNECT_PREFIX}${connectionId}:${disconnectedAt.getTime()}`;
}

export async function queueGoogleReconnectPushNotifications(ownerEmail?: string, db = getDb()) {
  const result = await db.execute(sql`insert into public.push_notification_jobs (owner_email,decision_id,title,subtitle,body,status)
    select c.owner_email,${GOOGLE_RECONNECT_PREFIX} || c.id::text || ':' || floor(extract(epoch from c.reconnect_required_at)*1000)::bigint::text,
      'Reconnect Google','', 'Reconnect Google so Dash can keep checking your email and calendar.','queued'
    from public.connected_google_accounts c where c.enabled=true and c.reconnect_required_at is not null
      and (${ownerEmail ?? null}::text is null or c.owner_email=${ownerEmail ?? null})
      and exists(select 1 from public.push_device_tokens t where t.owner_email=c.owner_email and t.enabled=true)
    on conflict(owner_email,decision_id) do nothing returning id`);
  return result.length;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function configuration(): ApnsConfiguration | null {
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim();
  const encodedKey = process.env.APNS_PRIVATE_KEY_BASE64?.trim();
  if (!teamId || !keyId || !bundleId || !encodedKey) return null;
  try {
    return { teamId, keyId, bundleId, privateKey: Buffer.from(encodedKey, "base64").toString("utf8") };
  } catch {
    return null;
  }
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function createApnsAuthorization(config: ApnsConfiguration, now = Date.now()) {
  const fingerprint = createHash("sha256")
    .update(`${config.teamId}:${config.keyId}:${config.privateKey}`)
    .digest("hex");
  if (cachedAuthorization && cachedAuthorization.fingerprint === fingerprint && now - cachedAuthorization.createdAt < 50 * 60_000) {
    return cachedAuthorization.value;
  }
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1_000) }));
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(config.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  const value = `${unsigned}.${base64url(signature)}`;
  cachedAuthorization = { value, createdAt: now, fingerprint };
  return value;
}

export async function registerPushDeviceToken(input: {
  ownerEmail: string;
  token: string;
  environment: PushEnvironment;
}) {
  const now = new Date();
  const [row] = await getDb().insert(pushDeviceTokens).values({
    ownerEmail: normalizedEmail(input.ownerEmail),
    token: input.token.toLowerCase(),
    environment: input.environment,
    enabled: true,
    lastRegisteredAt: now,
    lastError: null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: pushDeviceTokens.token,
    set: {
      ownerEmail: normalizedEmail(input.ownerEmail),
      environment: input.environment,
      enabled: true,
      lastRegisteredAt: now,
      lastError: null,
      updatedAt: now,
    },
  }).returning({ id: pushDeviceTokens.id });
  return row;
}

export async function unregisterPushDeviceToken(ownerEmailInput: string, token: string) {
  const [row] = await getDb().delete(pushDeviceTokens).where(and(
    eq(pushDeviceTokens.ownerEmail, normalizedEmail(ownerEmailInput)),
    eq(pushDeviceTokens.token, token.toLowerCase()),
  )).returning({ id: pushDeviceTokens.id });
  return Boolean(row);
}

const DECISION_UPDATE_SEPARATOR = ":discovery-update:";
export function decisionNotificationId(decision: Pick<Decision, "id" | "discoveryUpdateKey">) {
  return decision.discoveryUpdateKey
    ? `${decision.id}${DECISION_UPDATE_SEPARATOR}${createHash("sha256").update(decision.discoveryUpdateKey).digest("hex").slice(0, 24)}`
    : decision.id;
}
function notificationDecisionId(id: string) {
  return id.split(DECISION_UPDATE_SEPARATOR)[0]!;
}

export async function queueDecisionPushNotifications(ownerEmailInput: string, decisions: Decision[], db = getDb()) {
  if (!decisions.length) return 0;
  const ownerEmail = normalizedEmail(ownerEmailInput);
  const latest = [...new Map(decisions.map(decision => [decision.id, decision])).values()];
  const rows = await Promise.all(latest.map(async (decision) => ({
    ownerEmail,
    decisionId: decisionNotificationId(decision),
    title: messagePreview(decision.title).slice(0, 180),
    subtitle: "",
    body: messagePreview(decision.subtitle || "Open Dash to review your options.").slice(0, 220),
    status: await queuedNotificationStatus(ownerEmail, decision.id, db),
    createdAt: new Date(),
    updatedAt: new Date(),
  })));
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`decision-push:${ownerEmail}`},0))`);
    for (const decision of latest) {
      const currentId = decisionNotificationId(decision);
      await tx.execute(sql`update push_notification_jobs set status='suppressed',updated_at=now()
        where owner_email=${ownerEmail} and status in ('queued','failed') and decision_id<>${currentId}
          and (decision_id=${decision.id} or starts_with(decision_id,${decision.id + DECISION_UPDATE_SEPARATOR}))`);
    }
    const created = await tx.insert(pushNotificationJobs).values(rows)
      .onConflictDoNothing({target:[pushNotificationJobs.ownerEmail,pushNotificationJobs.decisionId]}).returning({id:pushNotificationJobs.id});
    return created.length;
  });
}

export async function queueRunAttentionPushNotification(input: {
  ownerEmail: string;
  runId: string;
  attentionId: string;
  title: string;
  body: string;
}, db = getDb()) {
  const now = new Date();
  const [created] = await db.insert(pushNotificationJobs).values({
    ownerEmail: normalizedEmail(input.ownerEmail),
    decisionId: `${RUN_ATTENTION_PREFIX}${input.runId}:${input.attentionId}`,
    title: messagePreview(input.title).slice(0, 180),
    subtitle: "",
    body: messagePreview(input.body).slice(0, 220),
    status: await queuedNotificationStatus(normalizedEmail(input.ownerEmail), `${RUN_ATTENTION_PREFIX}${input.runId}:${input.attentionId}`, db),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: [pushNotificationJobs.ownerEmail, pushNotificationJobs.decisionId] })
    .returning({ id: pushNotificationJobs.id });
  return Boolean(created);
}

export async function queueRunCompletionPushNotification(input: {
  completionId?: string;
  ownerEmail: string;
  runId: string;
  title: string;
  body: string;
}, db = getDb()) {
  if (!input.body.trim() || isGenericCompletionNotification(`${RUN_COMPLETION_PREFIX}${input.runId}`, input.body)) return false;
  const now = new Date();
  const [created] = await db.insert(pushNotificationJobs).values({
    ownerEmail: normalizedEmail(input.ownerEmail),
    decisionId: `${RUN_COMPLETION_PREFIX}${input.runId}${input.completionId ? `:${input.completionId}` : ""}`,
    title: messagePreview(input.title).slice(0, 180),
    subtitle: "",
    body: messagePreview(input.body).slice(0, 220),
    status: await queuedNotificationStatus(normalizedEmail(input.ownerEmail), `${RUN_COMPLETION_PREFIX}${input.runId}${input.completionId ? `:${input.completionId}` : ""}`, db),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: [pushNotificationJobs.ownerEmail, pushNotificationJobs.decisionId] })
    .returning({ id: pushNotificationJobs.id });
  return Boolean(created);
}

function runIdFromNotificationId(value: string) {
  const prefix = value.startsWith(RUN_ATTENTION_PREFIX)
    ? RUN_ATTENTION_PREFIX
    : value.startsWith(RUN_COMPLETION_PREFIX)
      ? RUN_COMPLETION_PREFIX
      : null;
  if (!prefix) return null;
  return value.slice(prefix.length).split(":", 1)[0] || null;
}

function collapseId(ownerEmail: string, decisionId: string) {
  return createHash("sha256").update(`${ownerEmail}:${decisionId}`).digest("hex").slice(0, 64);
}

export function conversationPushPayload(input: { decisionId: string; title: string; body: string; conversationId: string; ownerEmail: string }) {
  if (input.decisionId.startsWith(GOOGLE_RECONNECT_PREFIX)) return {
    aps: { alert: { title: input.title, body: input.body }, sound: "default", "thread-id": "google-connection" },
    notificationKind: "google_reconnect",
    replyAccountKey: undefined, avatarIndex: undefined,
  };
  const runId = runIdFromNotificationId(input.decisionId);
  return {
    aps: { alert: { title: messagePreview(input.title).slice(0, 180), body: messagePreview(input.body).slice(0, 220) },
      sound: "default", "mutable-content": 1, "thread-id": input.conversationId, category: "conversation.reply" },
    replyAccountKey: createHash("sha256").update(normalizedEmail(input.ownerEmail)).digest("hex"),
    conversationId: input.conversationId,
    avatarIndex: characterIndexFor(input.conversationId),
    ...(runId ? { notificationKind: input.decisionId.startsWith(RUN_COMPLETION_PREFIX) ? "run_completion" : "run_attention", runId }
      : { notificationKind: "decision", decisionId: notificationDecisionId(input.decisionId) }),
  };
}

/** Resolve the same stable identity and renamed title used by Home before delivery. */
export async function notificationConversation(job: { ownerEmail: string; decisionId: string; title: string; subtitle: string }, db = getDb()) {
  if (job.decisionId.startsWith(GOOGLE_RECONNECT_PREFIX)) {
    const connectionId = job.decisionId.slice(GOOGLE_RECONNECT_PREFIX.length).split(":")[0]!;
    const [account] = await db.select({ enabled: connectedGoogleAccounts.enabled, disconnectedAt: connectedGoogleAccounts.reconnectRequiredAt })
      .from(connectedGoogleAccounts).where(and(eq(connectedGoogleAccounts.ownerEmail, job.ownerEmail), eq(connectedGoogleAccounts.id, connectionId))).limit(1);
    const stale = !account?.enabled || !account.disconnectedAt || googleReconnectNotificationId(connectionId, account.disconnectedAt) !== job.decisionId;
    return { conversationId: "settings-google", title: job.title, archived: false, stale };
  }
  if (job.decisionId.startsWith(PROACTIVE_BUNDLE_PREFIX)) return { conversationId: "home", title: job.title, archived: true, stale: true }; // Retire unsent legacy bundles.
  const runId = runIdFromNotificationId(job.decisionId);
  const runs = runId ? await db.execute<{ decision_id: string | null; status: string; metadata: { automaticPause?: boolean } }>(sql`select decision_id,status,metadata from agent_runs where id::text=${runId} and user_id=${job.ownerEmail}`) : [];
  const decisionId = runId ? runs[0]?.decision_id : notificationDecisionId(job.decisionId);
  const key = decisionId ? `decision:${decisionId}` : `run:${runId}`;
  const rows = await db.execute<{ title: string | null; archived: boolean; decision: { activeRunId?: string; result?: unknown; actionableUntil?: string } | null; discarded: boolean }>(sql`
    select coalesce(preferences_json->'conversations'->${key}->>'title',
      (select item->>'title' from jsonb_array_elements(coalesce(state_json->'tasks','[]'::jsonb) || coalesce(state_json->'decisions','[]'::jsonb) || coalesce(state_json->'history','[]'::jsonb)) item
        where (${decisionId ?? null}::text is not null and (item->>'decisionId'=${decisionId ?? null} or item->>'id'=${decisionId ?? null}))
           or (${runId}::text is not null and (item->>'runId'=${runId} or item->>'activeRunId'=${runId})) limit 1)) as title,
      coalesce((preferences_json->'conversations'->${key}->>'archived')::boolean, false) as archived,
      (select item from jsonb_array_elements(coalesce(state_json->'decisions','[]'::jsonb)) item where item->>'id'=${decisionId ?? null} limit 1) as decision,
      coalesce(state_json->'discardedDecisionIds','[]'::jsonb) ? ${decisionId ?? ''} as discarded
    from workspace_states where owner_email=${job.ownerEmail}`);
  const card = rows[0]?.decision;
  const run = runs[0];
  const stale = runId
    ? job.decisionId.startsWith(RUN_ATTENTION_PREFIX) && job.decisionId.endsWith(':stuck') && (!run || !(run.status === 'awaiting_approval' || run.status === 'paused' && !run.metadata?.automaticPause))
    : !card || rows[0]?.discarded === true || Boolean(card.activeRunId || card.result) || Boolean(card.actionableUntil && Date.parse(card.actionableUntil) <= Date.now());
  return { conversationId: key, title: rows[0]?.title || job.subtitle || job.title, archived: rows[0]?.archived === true, stale };
}

async function queuedNotificationStatus(ownerEmail: string, decisionId: string, db = getDb()) {
  const conversation = await notificationConversation({ ownerEmail, decisionId, title: '', subtitle: '' }, db);
  // Retain the deduplication record so unarchiving never replays this alert.
  return conversation.archived ? 'suppressed' : 'queued';
}

function sendToApns(input: {
  conversationId: string;
  config: ApnsConfiguration;
  token: string;
  environment: PushEnvironment;
  ownerEmail: string;
  decisionId: string;
  title: string;
  subtitle: string;
  body: string;
}): Promise<DeliveryResult> {
  return postToApns({
    config: input.config, token: input.token, environment: input.environment,
    headers: { "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": collapseId(input.ownerEmail, input.decisionId) },
    payload: conversationPushPayload(input),
  });
}

function postToApns(input: {
  config: ApnsConfiguration;
  token: string;
  environment: PushEnvironment;
  headers: Record<string, string>;
  payload: unknown;
}): Promise<DeliveryResult> {
  const origin = input.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  return new Promise((resolve, reject) => {
    const client = http2.connect(origin);
    let settled = false;
    const finish = (result: DeliveryResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(error);
    };
    client.once("error", fail);
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${input.token}`,
      authorization: `bearer ${createApnsAuthorization(input.config)}`,
      "apns-topic": input.config.bundleId,
      ...input.headers,
      "content-type": "application/json",
    });
    let status = 0;
    let responseBody = "";
    request.setEncoding("utf8");
    request.once("error", fail);
    request.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    request.on("data", (chunk) => { responseBody += chunk; });
    request.on("end", () => {
      let reason: string | undefined;
      try { reason = (JSON.parse(responseBody) as { reason?: string }).reason; } catch { reason = undefined; }
      finish({ status, reason });
    });
    request.setTimeout(12_000, () => request.destroy(new Error("APNs request timed out.")));
    request.end(JSON.stringify(input.payload));
  });
}

/**
 * Silently wakes the owner's iPhones so a waiting read-only iPhone request can finish
 * without the user opening Dash. iOS may delay or drop these; the request stays pending.
 */
export async function sendAppleActionWakePush(input: { ownerEmail: string; runId: string; actionId: string; operation: string }, database?: ReturnType<typeof getDb>) {
  return sendSilentPush(input.ownerEmail, { dashAppleAction: { runId: input.runId, actionId: input.actionId, operation: input.operation } }, database);
}

/** A background push with no alert. iOS may delay or drop it; callers must tolerate that. */
export async function sendSilentPush(ownerEmail: string, data: Record<string, unknown>, database?: ReturnType<typeof getDb>) {
  const config = configuration();
  if (!config) return { configured: false, sent: 0 };
  const db = database ?? getDb();
  const tokens = await db.select().from(pushDeviceTokens).where(and(
    eq(pushDeviceTokens.ownerEmail, normalizedEmail(ownerEmail)),
    eq(pushDeviceTokens.enabled, true),
  ));
  let sent = 0;
  for (const token of tokens) {
    const result = await postToApns({
      config, token: token.token, environment: token.environment === "sandbox" ? "sandbox" : "production",
      headers: { "apns-push-type": "background", "apns-priority": "5" },
      payload: { aps: { "content-available": 1 }, ...data },
    }).catch(() => null);
    if (result?.status === 200) sent++;
  }
  return { configured: true, sent };
}

function invalidTokenResponse(result: DeliveryResult) {
  return result.status === 410 || (
    result.status === 400
    && ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(result.reason ?? "")
  );
}

export async function deliverPendingPushNotifications(input: { ownerEmail?: string; limit?: number; includeRecent?: boolean } = {}, database?: ReturnType<typeof getDb>) {
  const config = configuration();
  if (!config) return { configured: false, processed: 0, sent: 0, failed: 0 };
  const db = database ?? getDb();
  await db.update(pushNotificationJobs).set({
    status: "failed",
    lastError: "Delivery lease expired before completion.",
    updatedAt: new Date(),
  }).where(and(
    eq(pushNotificationJobs.status, "processing"),
    lt(pushNotificationJobs.updatedAt, new Date(Date.now() - 5 * 60_000)),
    lt(pushNotificationJobs.attempts, 6),
  ));
  await queueGoogleReconnectPushNotifications(input.ownerEmail, db);
  const retryBefore = new Date(Date.now() + (input.includeRecent ? 1_000 : -30_000));
  const conditions = [
    inArray(pushNotificationJobs.status, ["queued", "failed"]),
    lt(pushNotificationJobs.updatedAt, retryBefore),
    lt(pushNotificationJobs.attempts, 6),
  ];
  if (input.ownerEmail) conditions.push(eq(pushNotificationJobs.ownerEmail, normalizedEmail(input.ownerEmail)));
  const jobs = await db.select().from(pushNotificationJobs)
    .where(and(...conditions))
    .orderBy(asc(pushNotificationJobs.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 25, 1), 100));
  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  for (const job of jobs) {
    const [claimed] = await db.update(pushNotificationJobs).set({
      status: "processing",
      attempts: job.attempts + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(pushNotificationJobs.id, job.id),
      inArray(pushNotificationJobs.status, ["queued", "failed"]),
    )).returning();
    if (!claimed) continue;

    const conversation = await notificationConversation(job, db);
    if (conversation.archived || conversation.stale || isGenericCompletionNotification(job.decisionId, job.body)) {
      await db.update(pushNotificationJobs).set({ status: 'suppressed', lastError: null, updatedAt: new Date() })
        .where(eq(pushNotificationJobs.id, job.id));
      suppressed++;
      continue;
    }
    const tokens = await db.select().from(pushDeviceTokens).where(and(
      eq(pushDeviceTokens.ownerEmail, job.ownerEmail),
      eq(pushDeviceTokens.enabled, true),
    ));
    let transientError: string | null = null;
    for (const token of tokens) {
      try {
        const result = await sendToApns({
          config,
          token: token.token,
          environment: token.environment === "sandbox" ? "sandbox" : "production",
          ownerEmail: job.ownerEmail,
          decisionId: job.decisionId,
          ...conversation,
          subtitle: job.subtitle,
          body: job.body,
        });
        if (result.status === 200) {
          await db.update(pushDeviceTokens).set({ lastUsedAt: new Date(), lastError: null, updatedAt: new Date() })
            .where(eq(pushDeviceTokens.id, token.id));
        } else if (invalidTokenResponse(result)) {
          await db.update(pushDeviceTokens).set({
            enabled: false,
            lastError: result.reason ?? `APNs ${result.status}`,
            updatedAt: new Date(),
          }).where(eq(pushDeviceTokens.id, token.id));
        } else {
          transientError = result.reason ?? `APNs returned ${result.status}.`;
          await db.update(pushDeviceTokens).set({ lastError: transientError, updatedAt: new Date() })
            .where(eq(pushDeviceTokens.id, token.id));
        }
      } catch (error) {
        transientError = error instanceof Error ? error.message : String(error);
      }
    }

    if (transientError) {
      failed += 1;
      await db.update(pushNotificationJobs).set({ status: "failed", lastError: transientError, updatedAt: new Date() })
        .where(eq(pushNotificationJobs.id, job.id));
    } else {
      sent += 1;
      await db.update(pushNotificationJobs).set({
        status: "sent",
        lastError: null,
        sentAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(pushNotificationJobs.id, job.id));
    }
  }

  return { configured: true, processed: sent + failed + suppressed, sent, failed, suppressed };
}
