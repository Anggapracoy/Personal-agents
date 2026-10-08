import { after, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../auth";
import { agentModelMetadata } from "../../../../lib/agent-model-settings";
import { getAgentModelSettings } from "../../../../lib/agent-model-settings-store";
import { enforceApiQuota } from "../../../../lib/api-quota";
import { parseChatFiles } from "../../../../lib/harness/chat-files";
import { suggestConversationIdentity } from "../../../../lib/harness/conversation-identity";
import { finishShareSetup } from "../../../../lib/harness/share-setup";
import { dispatchInteractiveRun } from "../../../../lib/harness/dispatch";
import { attachGoogleSecrets } from "../../../../lib/harness/google-secrets";
import { getRunStore } from "../../../../lib/harness/store";
import { compactLifeMemory } from "../../../../lib/life-memory-context";
import { getLifeProfile } from "../../../../lib/life-profile";
import { validTimeZone } from "../../../../lib/temporal";

export const maxDuration = 30;

const shareSchema = z.object({
  requestId: z.string().uuid(),
  message: z.string().max(4_000).default(""),
  text: z.string().max(12_000).default(""),
  url: z.string().max(2_000).default(""),
  sourceApp: z.string().max(120).default("iPhone"),
  timeZone: z.string().max(80).optional(),
  files: z.unknown().optional(),
});

/** Starts a conversation straight from the iPhone share sheet, without opening the app. */
export async function POST(request: Request) {
  const session = await auth();
  const owner = session?.user?.email?.trim().toLowerCase();
  if (!owner) return NextResponse.json({ error: "Sign in to Dash to share." }, { status: 401 });
  const parsed = shareSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "This shared item couldn’t be read." }, { status: 400 });
  const input = parsed.data;
  let files: ReturnType<typeof parseChatFiles>;
  try { files = parseChatFiles(input.files); } catch { return NextResponse.json({ error: "Share up to 6 files, 3 MB total." }, { status: 400 }); }
  const url = input.url.trim();
  const sharedText = input.text.trim();
  const shared = [sharedText, url && !sharedText.includes(url) ? url : ""].filter(Boolean).join("\n\n");
  const message = input.message.trim();
  if (!message && !shared && !files.length) return NextResponse.json({ error: "Share some text, a link, a photo, or a file." }, { status: 400 });

  const store = getRunStore();
  // Retrying the same share returns the conversation it already started.
  const decisionId = `message-${input.requestId}`;
  const existing = await store.findLatestRun(owner, decisionId);
  if (!existing) {
    const limited = await enforceApiQuota(owner, "run");
    if (limited) return limited;
  }

  const userMessage = [message, shared].filter(Boolean).join("\n\n") || "Shared an attachment";
  const requestText = [message, shared].filter(Boolean).join("\n\n") || "Read the attached material and help with the request it contains. Ask if the intended task is unclear.";
  const title = (message || sharedText || url || "Shared item").slice(0, 80);
  const [settings, life] = await Promise.all([getAgentModelSettings(), getLifeProfile(owner)]);
  const run = existing ?? await store.createRun({
    userId: owner, decisionId, category: "social", request: requestText.slice(0, 16_000), title,
    metadata: {
      sourceType: "manual", userMessage: userMessage.slice(0, 16_000), initialConversationTitle: title, externalOrigin: "share",
      sharedFrom: input.sourceApp.trim() || "iPhone", userProfile: { name: session?.user?.name?.trim() || owner.split("@")[0], email: owner },
      lifeMemory: compactLifeMemory(life), userTimeZone: validTimeZone(input.timeZone) ?? life.profile?.timeZone ?? "UTC",
      ...agentModelMetadata(settings), browserRuntime: "browserless",
    },
  });
  await finishShareSetup({ store, runId: run.id, files,
    attachSecrets: () => attachGoogleSecrets(store, run.id, owner, (session as typeof session & { accessToken?: string }).accessToken, null),
    dispatch: dispatchInteractiveRun,
  });
  after(() => suggestConversationIdentity(store, run.id, owner).catch(() => undefined));
  return NextResponse.json({ runId: run.id, decisionId }, { status: existing ? 200 : 201, headers: { "cache-control": "private, no-store" } });
}
