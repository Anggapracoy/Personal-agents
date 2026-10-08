
import { normalizeAppleConnections } from "../../../../../lib/apple/connection-context";
import { enforceApiQuota } from "../../../../../lib/api-quota";
import { withHarnessTiming, timeHarnessOperation } from "../../../../../lib/harness/timing";
import { reactionInputSchema } from "../../../../../lib/harness/reactions";
import { threadItems } from "../../../../../lib/harness/thread";
import { parseChatFiles } from "../../../../../lib/harness/chat-files";
import { getScheduleStore } from "../../../../../lib/schedules/store";
import { appendConversationReply, appendConversationReaction, ConversationBusyError } from "../../../../../lib/harness/conversation-reply";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { getOwnedRun } from "../../../../../lib/auth/owned-run";
import { dispatchInteractiveRun } from "../../../../../lib/harness/dispatch";
import { prepareGoogleSecrets, sourceAccountIdOf } from "../../../../../lib/harness/google-secrets";
import { getRunStore } from "../../../../../lib/harness/store";
import { prepareInteractiveStart } from "../../../../../lib/harness/interactive-start";

export const maxDuration = 300;

/**
 * Send a follow-up on an existing thread. Works when the thread is idle (done,
 * failed, cancelled) or waiting on the user: a new message supersedes whatever
 * the agent was waiting for. Active runs receive durable steering input.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withHarnessTiming("message", id, () => postMessage(request, id));
}

async function postMessage(request: Request, id: string) {
  const body = await request.json().catch(() => ({})) as { appleConnections?: unknown; text?: string; files?: unknown; reaction?: unknown; replyTo?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  let files: ReturnType<typeof parseChatFiles>;
  try { files = parseChatFiles(body.files); } catch { return NextResponse.json({ error: "Attach up to 6 valid files, 3 MB total." }, { status: 400 }); }
  const reaction = body.reaction === undefined ? null : reactionInputSchema.safeParse(body.reaction);
  if (reaction && (!reaction.success || text || files.length)) return NextResponse.json({ error: "Choose a valid message reaction." }, { status: 400 });
  if (!reaction && !text && !files.length) return NextResponse.json({ error: "Say something first." }, { status: 400 });
  if (text.length > 16_000) return NextResponse.json({ error: "Message is too long." }, { status: 400 });
  const session = await timeHarnessOperation("auth.session", () => auth());
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const owned = await timeHarnessOperation("auth.run", () => getOwnedRun(id, session));
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.run || !owned.email) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const limited = await timeHarnessOperation("quota.reply", () => enforceApiQuota(owned.email!, "reply"));
  if (limited) return limited;
  const startLocally = prepareInteractiveStart();
  const store = getRunStore();
  const snapshot = body.replyTo !== undefined || (!reaction && ["awaiting_approval", "paused"].includes(owned.run.status))
    ? await store.getSnapshot(id) : null;
  let replyTo: import("../../../../../lib/harness/reactions").ReplyContext | undefined;
  if (body.replyTo !== undefined) {
    if (typeof body.replyTo !== "string" || reaction) return NextResponse.json({ error: "Choose a valid reply target." }, { status: 400 });
    if (!snapshot) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    const target = threadItems(snapshot, await store.listMessages(id)).find(item => item.id === body.replyTo);
    if (!target || (target.kind !== "user" && target.kind !== "agent")) return NextResponse.json({ error: "Reply message not found." }, { status: 404 });
    replyTo = { messageId: target.id, role: target.kind, text: target.text };
  }
  // Preparation may overlap message storage, but errors affect only a newly
  // started turn. Existing workers handling steering retain their credentials.
  const preparedGoogle = !reaction && !["running", "planning"].includes(owned.run.status)
    ? timeHarnessOperation("google.prepare", () => prepareGoogleSecrets(owned.email!, (session as typeof session & { accessToken?: string }).accessToken, sourceAccountIdOf(owned.run!.metadata)))
      .then(values => ({ ok: true as const, values }), error => ({ ok: false as const, error }))
    : null;
  try {
    const metadata = { appleConnections: normalizeAppleConnections(body.appleConnections) };
    let mode: "started" | "steering" | "duplicate" | "busy";
    if (reaction?.success) {
      await store.updateRunMetadata(id, metadata);
      const accepted = await appendConversationReaction(store, id, reaction.data);
      if (!accepted) return NextResponse.json({ error: "Message not found." }, { status: 404 });
      mode = accepted;
      if (mode === "duplicate") return NextResponse.json(await store.getSnapshot(id), { status: 202 });
    } else mode = await appendConversationReply(store, id, text || `Attached: ${files.map(file => file.name).join(", ")}`, files, replyTo, metadata);
    await preparedGoogle;
    if (mode === "steering") {
      // A running status does not prove a worker is alive. The execution lock
      // serializes this wake with any existing worker; queued input stays durable.
      if (await timeHarnessOperation("inngest.dispatch", () => dispatchInteractiveRun(id))) startLocally(id);
      return NextResponse.json(await store.getSnapshot(id), { status: 202 });
    }
  }
  catch (error) { await preparedGoogle; if (error instanceof ConversationBusyError) return NextResponse.json({ error: error.message }, { status: 409 }); throw error; }

  try {
    if (!reaction && (owned.run.status === "awaiting_approval" || owned.run.status === "paused")) {
      await store.rejectPendingActions(id);
      if (snapshot?.actions.some((action) => action.status === "proposed" && action.toolName === "browser_request_takeover")) {
        const { getCloudBrowser } = await import("../../../../../lib/harness/browser/registry");
        await getCloudBrowser(owned.email, id).endTakeoverStream(owned.email).catch(() => undefined);
      }
    }
    if (owned.run.metadata.scheduleExecution) await getScheduleStore().abandonForUserReply(id);
    await timeHarnessOperation("google.attach", async () => {
      const prepared = await preparedGoogle;
      if (prepared && !prepared.ok) throw prepared.error;
      const values = prepared?.values ?? await prepareGoogleSecrets(owned.email!, (session as typeof session & { accessToken?: string }).accessToken, sourceAccountIdOf(owned.run!.metadata));
      await store.putSecrets(id, values);
    });
    if (await timeHarnessOperation("inngest.dispatch", () => dispatchInteractiveRun(id))) startLocally(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Your reply could not start.";
    await store.updateRun(id, { status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json(await store.getSnapshot(id), { status: 202 });
}
