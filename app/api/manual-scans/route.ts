import { withRequestBodyLimit } from "../../../lib/request-body-limit";
import { enforceApiQuota } from "../../../lib/api-quota";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserEmail } from "../../../lib/auth/session";
import {
  cancelManualScan,
  claimQueuedManualScanForRedispatch,
  enqueueManualScan,
  failExpiredManualScan,
  failManualScan,
  getLatestManualScanJob,
  getManualScanJob,
} from "../../../lib/discovery/manual-scan-jobs";
import { inngest } from "../../../lib/harness/inngest-client";

const requestSchema = z.object({
  forceFullScan: z.boolean().optional(),
  userTimeZone: z.string().trim().min(1).max(100).optional(),
  deviceCalendarEvents: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
});

export async function GET(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const jobId = new URL(request.url).searchParams.get("id");
  let job = jobId ? await getManualScanJob(email, jobId) : await getLatestManualScanJob(email);
  if (job && (job.status === "queued" || job.status === "running")) {
    if (await failExpiredManualScan(job.id)) {
      job = await getManualScanJob(email, job.id);
    } else if (job.status === "queued" && await claimQueuedManualScanForRedispatch(job.id)) {
      try {
        await inngest.send({
          name: "decision-feed/manual.scan.requested",
          data: { jobId: job.id, ownerEmail: email },
        });
      } catch (error) {
        await failManualScan(job.id, error);
      }
      job = await getManualScanJob(email, job.id);
    }
  }
  return NextResponse.json({ job }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const limited = await enforceApiQuota(email, "scan");
  if (limited) return limited;
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid scan request." }, { status: 400 });
  const queued = await enqueueManualScan({ ownerEmail: email, ...parsed.data });
  if (queued.created) {
    try {
      await inngest.send({
        name: "decision-feed/manual.scan.requested",
        data: { jobId: queued.job.id, ownerEmail: email },
      });
    } catch (error) {
      await failManualScan(queued.job.id, error);
      return NextResponse.json({ error: "The background scan could not be queued." }, { status: 503 });
    }
  }
  return NextResponse.json(queued, { status: queued.created ? 202 : 200 });
}

async function DELETEHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const jobId = new URL(request.url).searchParams.get("id")?.trim();
  if (!jobId) return NextResponse.json({ error: "A scan job is required." }, { status: 400 });

  const result = await cancelManualScan(email, jobId);
  if (!result.job) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  if (result.cancelled) {
    await inngest.send({
      name: "decision-feed/manual.scan.cancelled",
      data: { jobId, ownerEmail: email },
    }).catch(() => undefined);
  }
  return NextResponse.json(result);
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);

export const DELETE = withRequestBodyLimit(DELETEHandler, 1048576);
