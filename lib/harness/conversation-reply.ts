import { reactionMessage, type ReactionInput, type ReplyContext } from "./reactions";
import { threadItems } from "./thread";
import type { ModelMessage } from "ai";
import { chatFileContent, saveChatFiles, type parseChatFiles } from "./chat-files";
import type { RunStore } from "./types";

export class ConversationBusyError extends Error { constructor() { super("This conversation is resuming. Try sending again in a moment."); } }

/** Continue the existing transcript without injecting a second completion reply. */
export async function appendConversationReply(store: RunStore, id: string, text: string, files: ReturnType<typeof parseChatFiles> = [], replyTo?: ReplyContext, metadata: Record<string, unknown> = {}) {
  const attachments = await saveChatFiles(store, id, files);
  const message: ModelMessage = { ...((replyTo || attachments.length) ? { providerOptions: { wdyt: { ...(replyTo ? { replyTo } : {}), attachmentIds: attachments.map(file => file.id), attachmentNames: Object.fromEntries(attachments.map((file, index) => [file.id, files[index].name])) } } } : {}), role: "user" as const, content: files.length || replyTo ? [{ type: "text" as const, text }, ...chatFileContent(attachments), ...(replyTo ? [{ type: "text" as const, text: `[reply context] The user is replying specifically to ${replyTo.role} message ${replyTo.messageId}: ${JSON.stringify(replyTo.text)}` }] : [])] : text };
  const mode = await store.acceptReply(id, message, metadata);
  if (mode === "missing") throw new Error("Conversation not found.");
  if (mode === "busy") throw new ConversationBusyError();
  return mode;
}

/** Resolve the target server-side; the client cannot invent quoted text or another thread's message. */
export async function appendConversationReaction(store: RunStore, id: string, input: ReactionInput) {
  const snapshot = await store.getSnapshot(id);
  if (!snapshot) throw new Error("Conversation not found.");
  const target = threadItems(snapshot, await store.listMessages(id)).find(item => item.id === input.messageId && (item.kind === "agent" || item.kind === "user"));
  if (!target || (target.kind !== "agent" && target.kind !== "user")) return null;
  let mode = await store.acceptReaction(id, reactionMessage(input, "user", target.text));
  if (mode === "busy") throw new ConversationBusyError();
  // A failed dispatch can be retried without appending a second reaction event.
  if (mode === "duplicate" && (await store.getRun(id))?.status === "failed" && await store.claimRunForReply(id)) {
    await store.updateRun(id, { status: "running", error: null, response: "", result: null, completedAt: null });
    mode = "started";
  }
  return mode;
}
