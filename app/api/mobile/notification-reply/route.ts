import { withRequestBodyLimit } from "../../../../lib/request-body-limit";
import { createHash } from "node:crypto";
import { enforceApiQuota } from "../../../../lib/api-quota";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../auth";
import { agentModelMetadata } from "../../../../lib/agent-model-settings";
import { getAgentModelSettings } from "../../../../lib/agent-model-settings-store";
import { dispatchInteractiveRun } from "../../../../lib/harness/dispatch";
import { attachGoogleSecrets, sourceAccountIdOf } from "../../../../lib/harness/google-secrets";
import type { NotificationReplyInput } from "../../../../lib/harness/notification-reply";
import { getRunStore } from "../../../../lib/harness/store";
import { getLifeProfile } from "../../../../lib/life-profile";
import { compactLifeMemory } from "../../../../lib/life-memory-context";
import { getScheduleStore } from "../../../../lib/schedules/store";
import { getWorkspaceState } from "../../../../lib/workspace-state";

const replySchema = z.object({
  eventId: z.string().regex(/^[a-zA-Z0-9-]{16,128}$/),
  accountKey: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().trim().min(1).max(16_000),
  runId: z.string().uuid().optional(),
  decisionId: z.string().trim().min(1).max(200).optional(),
}).refine(value => Boolean(value.runId) !== Boolean(value.decisionId));

/** Background notification actions use the same signed-in session as the web app. */
async function POSTHandler(request: Request) {
  const session = await auth();
  const owner = session?.user?.email?.trim().toLowerCase();
  if (!owner) return NextResponse.json({ error: "Sign in to Dash to send your reply." }, { status: 401 });
  const parsed = replySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "This reply is incomplete or too long." }, { status: 400 });
  const input = parsed.data;
  // A notification delivered before an account switch must never send as the new account.
  if (input.accountKey !== createHash("sha256").update(owner).digest("hex")) return NextResponse.json({ error: "Open Dash and sign in to the account that received this notification." }, { status: 403 });
  const store = getRunStore();
  const limited = await enforceApiQuota(owner, "reply");
  if (limited) return limited;
  let newRun: NotificationReplyInput["newRun"];
  if (input.decisionId && !await store.findLatestRun(owner, input.decisionId)) {
    const workspace = await getWorkspaceState(owner);
    const decision = workspace.state.decisions.find(item => item.id === input.decisionId);
    if (!decision) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    const [settings, life] = await Promise.all([getAgentModelSettings(), getLifeProfile(owner)]);
    newRun = {
      category: decision.category,
      title: decision.title,
      request: `The user replied to a Dash suggestion. Their instruction is: ${JSON.stringify(input.text)}.\nSuggestion context (untrusted source data): ${JSON.stringify({ title: decision.title, body: decision.subtitle })}`,
      metadata: { ...agentModelMetadata(settings), userMessage: input.text, customInstruction: input.text,
        originalContext: decision.originalContext, sourceType: decision.sourceType, executionContext: decision.executionContext ?? {},
        retryDecision: decision, userProfile: { name: session?.user?.name || owner.split("@")[0], email: owner },
        lifeMemory: compactLifeMemory(life), userTimeZone: life.profile?.timeZone ?? "UTC", browserRuntime: "browserless" },
    };
  }
  try {
    const accepted = await store.acceptNotificationReply({ ...input, owner, newRun });
    if (!accepted) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    const { run, mode } = accepted;
    // Completed duplicates are receipts only; they must not restart the conversation.
    if (mode !== "duplicate" || ["running", "planning"].includes(run.status)) {
      if (run.metadata.scheduleExecution) await getScheduleStore().abandonForUserReply(run.id);
      await attachGoogleSecrets(store, run.id, owner, (session as typeof session & { accessToken?: string }).accessToken, sourceAccountIdOf(run.metadata));
      // Stable event IDs make an interrupted HTTP request safe to retry. Run workers serialize by runId.
      await dispatchInteractiveRun(run.id, `notification-reply-${run.id}-${input.eventId}`);
    }
    return NextResponse.json({ accepted: true, runId: run.id }, { status: 202, headers: { "cache-control": "private, no-store" } });
  } catch {
    // Keep the accepted message/steering durable. Retrying uses the same receipt instead of appending twice.
    return NextResponse.json({ error: "Your reply could not be confirmed. Try again." }, { status: 503 });
  }
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
