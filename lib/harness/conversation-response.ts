import { tool, type ModelMessage } from "ai";
import { z } from "zod";
import { isReactionEmoji, reactionMessage } from "./reactions";
import { threadItems } from "./thread";
import type { RunStore } from "./types";

export function withoutAssistantText(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap<ModelMessage>(message => {
    if (message.role !== "assistant") return [message];
    if (typeof message.content === "string") return [];
    const content = message.content.filter(part => part.type !== "text");
    return content.length ? [{ ...message, content }] : [];
  });
}
export function conversationResponseTools(store: RunStore, runId: string, finish: () => void) {
  const end = async (mode: "silent" | "reaction") => {
    await store.updateRunMetadata(runId, { responseDisposition: mode, replyTyping: false });
    await store.updateRun(runId, { response: "", result: null });
    finish();
    return { accepted: true, detail: "Turn ended. Do not add text or call another tool." };
  };
  return {
    finish_without_reply: tool({
      description: "End this turn silently: no message, emoji, summary, or completion notification. Use when asked not to respond, or no response is warranted. Complete any requested work first. Never use after report_check with notify=true; finish with a chat message explaining that outcome instead. Make this the only tool in the final step.",
      inputSchema: z.object({}), execute: () => end("silent"),
    }),
    react_to_message: tool({
      description: "Attach one emoji to a user message and end the turn without a text reply. For small social acknowledgments only, not a replacement for an answer or requested work. Use a real user message ID from the conversation. Make this the only tool in the final step.",
      inputSchema: z.object({ messageId: z.string(), emoji: z.string().refine(isReactionEmoji) }),
      execute: async ({ messageId, emoji }) => {
        const snapshot = await store.getSnapshot(runId);
        if (!snapshot) return { accepted: false, detail: "Conversation unavailable." };
        const target = threadItems(snapshot, await store.listMessages(runId)).find(item => item.id === messageId && item.kind === "user");
        if (!target || target.kind !== "user") return { accepted: false, detail: "Choose an existing user message ID in this conversation." };
        await store.appendMessages(runId, [reactionMessage({ eventId: crypto.randomUUID(), messageId, emoji }, "agent", target.text)]);
        return end("reaction");
      },
    }),
  };
}
