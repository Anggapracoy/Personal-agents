import { getScheduleStore } from "../../../../../lib/schedules/store";
import { NextResponse } from "next/server";
import { inngest } from "../../../../../lib/harness/inngest-client";
import { getRunStore } from "../../../../../lib/harness/store";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { getCloudBrowser } from "../../../../../lib/harness/browser/registry";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const store = getRunStore();
  const run = await store.updateRun(id, { status: "cancelled", completedAt: new Date().toISOString() });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  await store.rejectPendingActions(id);
  if (owned.email && owned.snapshot.actions.some(action => action.toolName.startsWith("browser_"))) {
    await getCloudBrowser(owned.email, id).setWaitingForUser(false, true);
  }
  if (owned.snapshot.metadata.scheduleExecution) await getScheduleStore().abandonForUserReply(id, true);
  if (owned.email && owned.snapshot.actions.some((action) => action.status === "proposed" && action.toolName === "browser_request_takeover")) await getCloudBrowser(owned.email, id).endTakeoverStream(owned.email).catch(() => undefined);
  if (process.env.INNGEST_EVENT_KEY) await inngest.send({ name: "decision-feed/run.cancelled", data: { runId: id } });
  return NextResponse.json(await store.getSnapshot(id));
}
