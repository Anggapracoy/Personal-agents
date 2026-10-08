import { publishCreatedRun } from "../../../lib/workspace-state";
import { seedMessages } from "../../../lib/harness/initial-messages";

import { getAgentModelSettings } from "../../../lib/agent-model-settings-store";
import { enforceApiQuota } from "../../../lib/api-quota";
import { clientRunMetadataSchema } from "../../../lib/harness/client-metadata";
import { agentModelMetadata } from "../../../lib/agent-model-settings";
import { normalizeAppleConnections } from "../../../lib/apple/connection-context";
import { isReactionEmoji } from "../../../lib/harness/reactions";
import { parseChatFiles, saveChatFiles } from "../../../lib/harness/chat-files";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { dispatchInteractiveRun } from "../../../lib/harness/dispatch";
import { prepareGoogleSecrets, sourceAccountIdOf } from "../../../lib/harness/google-secrets";
import { getRunStore } from "../../../lib/harness/store";
import { createTemporalContext, validTimeZone } from "../../../lib/temporal";
import { getLifeProfile } from "../../../lib/life-profile";
import { compactLifeMemory } from "../../../lib/life-memory-context";
import { withHarnessTiming, timeHarnessOperation } from "../../../lib/harness/timing";
import { prepareInteractiveStart } from "../../../lib/harness/interactive-start";

export const maxDuration = 300;

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const decisionId = new URL(request.url).searchParams.get("decisionId")?.trim();
  if (!decisionId || decisionId.length > 200) return NextResponse.json({ error: "A valid decisionId is required." }, { status: 400 });
  const store = getRunStore();
  const run = await store.findLatestRun(userId, decisionId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(await store.getSnapshot(run.id));
}

/** Start a new thread. Follow-ups on an existing thread go to POST /api/runs/[id]/message. */
export async function POST(request: Request) {
  let runId: string | undefined;
  return withHarnessTiming("create", () => runId, () => createRun(request, id => { runId = id; }));
}

async function createRun(request: Request, onCreated: (id: string) => void) {
  const body = await timeHarnessOperation("request.parse", () => request.json().catch(() => ({}))) as { appleConnections?: unknown; decisionId?: string; category?: string; request?: string; title?: string; metadata?: Record<string, unknown>; modelProvider?: string; modelId?: string; reasoningEffort?: string; files?: unknown };
  if (typeof body.request !== "string" || !body.request.trim()) return NextResponse.json({ error: "request is required" }, { status: 400 });
  if (body.request.length > 16000) return NextResponse.json({ error: "Request is too long." }, { status: 400 });
  let files: ReturnType<typeof parseChatFiles>;
  try { files = parseChatFiles(body.files); } catch { return NextResponse.json({ error: "Attach up to 6 valid files, 3 MB total." }, { status: 400 }); }
  if (JSON.stringify(body.metadata ?? {}).length > 1_000_000) return NextResponse.json({ error: "Execution context is too large" }, { status: 413 });
  const session = await timeHarnessOperation("auth.session", () => auth());
  const userId = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  // These reads are scoped to the authenticated owner and can overlap access
  // checks. Capture failures now; surface them only if the request is admitted.
  const preparedContext = Promise.all([
    timeHarnessOperation("context.model_settings", () => getAgentModelSettings()),
    timeHarnessOperation("context.life_profile", () => getLifeProfile(userId)),
  ]).then(values => ({ ok: true as const, values }), error => ({ ok: false as const, error }));
  const userName = session?.user?.name?.trim() || userId.split("@")[0];
  const store = getRunStore();
  // Establish connections while the quota query runs; this does not create a
  // run or start execution, and failures leave normal connection handling intact.
  void store.prepareConnections?.().catch(() => undefined);
  const limited = await timeHarnessOperation("quota.run", () => enforceApiQuota(userId, "run"));
  if (limited) return limited;
  const parsedMetadata = clientRunMetadataSchema.safeParse(body.metadata ?? {});
  if (!parsedMetadata.success) return NextResponse.json({ error: "Invalid conversation context." }, { status: 400 });
  const metadata = { ...parsedMetadata.data, appleConnections: normalizeAppleConnections(body.appleConnections) } as Record<string, unknown>;
  for (const key of ["scheduleExecution", "scheduledCheckResult", "actionScopeId"]) delete metadata[key];
  delete metadata.initialAttachmentIds;
  delete metadata.initialAttachmentNames;
  delete metadata.initialConversationTitle;
  delete metadata.conversationIdentityGenerated;
  delete metadata.responseDisposition;
  delete metadata.currentActivityActionId;
  delete metadata.taskWorkStarted;
  if (metadata.initialReaction !== undefined && (typeof metadata.initialReaction !== "string" || !isReactionEmoji(metadata.initialReaction) || metadata.sourceType === "manual")) return NextResponse.json({ error: "Choose a valid message reaction." }, { status: 400 });
  if (metadata.sourceType === "manual" && metadata.generateConversationIdentity === true) metadata.initialConversationTitle = body.title?.trim() || body.request.trim().slice(0, 80);
  delete metadata.generateConversationIdentity;
  const preparedGoogle = timeHarnessOperation("google.prepare", () => prepareGoogleSecrets(userId, (session as typeof session & { accessToken?: string }).accessToken, sourceAccountIdOf(metadata)))
    .then(values => ({ ok: true as const, values }), error => ({ ok: false as const, error }));
  const startLocally = prepareInteractiveStart();
  const context = await preparedContext;
  if (!context.ok) throw context.error;
  const [settings, lifeMemory] = context.values;
  const { modelProvider, modelId, reasoningEffort } = agentModelMetadata(settings);
  const userTimeZone = validTimeZone(body.metadata?.userTimeZone) ?? "UTC";
  const inlineCredentials = files.length === 0 ? await preparedGoogle : null;
  if (inlineCredentials && !inlineCredentials.ok) throw inlineCredentials.error;
  const run = await store.createRun({ userId, decisionId: body.decisionId ?? null, category: body.category ?? "social", request: body.request.trim(), title: body.title?.trim() || body.request.trim().slice(0, 80), metadata: { ...metadata, runPreparationPending: true, workspacePublicationPending: true, userProfile: { name: userName, email: userId }, lifeMemory: compactLifeMemory(lifeMemory), userTimeZone, modelProvider, modelId, reasoningEffort, browserRuntime: "browserless" } }, files.length === 0 && metadata.sourceType === "manual" ? created => seedMessages(created, createTemporalContext(userTimeZone)) : undefined, inlineCredentials?.values);
  onCreated(run.id);
  try {
  const attachments = await timeHarnessOperation("attachments.save", () => saveChatFiles(store, run.id, files));
  if (attachments.length) await store.updateRunMetadata(run.id, { initialAttachmentIds: attachments.map(file => file.id), initialAttachmentNames: Object.fromEntries(attachments.map((file, index) => [file.id, files[index].name])) });
  if (!inlineCredentials) await timeHarnessOperation("google.attach", async () => {
    const prepared = await preparedGoogle;
    if (!prepared.ok) throw prepared.error;
    await store.putSecrets(run.id, prepared.values);
  });
  await store.updateRunMetadata(run.id, { runPreparationPending: false });
  } catch (error) {
    await store.updateRun(run.id, { status: "failed", error: "Your request could not be prepared. Please try again.", completedAt: new Date().toISOString() });
    throw error;
  }
  try {
    await publishCreatedRun((await store.getRun(run.id))!);
    await store.updateRunMetadata(run.id, { workspacePublicationPending: false });
  } catch {
    // Inputs are complete: accept the chat and let workspace reconciliation restore
    // a missed publication. Do not turn a transient list-save failure into a failed send.
    console.warn("[workspace] Prepared chat awaits publication recovery", { runId: run.id });
  }
  try {
    if (await timeHarnessOperation("inngest.dispatch", () => dispatchInteractiveRun(run.id))) startLocally(run.id);
  } catch {
    // The fully prepared, published request is accepted; durable recovery can redispatch it.
    console.warn("[agent-dispatch] Prepared chat saved for recovery", { runId: run.id });
  }
  const snapshot = await store.getSnapshot(run.id);
  return timeHarnessOperation("response.serialize", async () => NextResponse.json(snapshot, { status: 201 }));
}
