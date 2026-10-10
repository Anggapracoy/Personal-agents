import type { ModelMessage } from "ai";
import type { AgentMessage } from "./types";

// Leave headroom for tool results and reasoning before the next compaction pass.
export const OPENAI_COMPACT_THRESHOLD = 200_000;
export function openAICompactThreshold(modelId: string) {
  // Sol 6.1 has a 1.05M context window. Leave 200K for output and tool results.
  return modelId === "gpt-6.1-sol" ? 850_000 : OPENAI_COMPACT_THRESHOLD;
}
export const PERSISTED_COMMENTARY_KIND = "wdyt.persisted-commentary";

type AssistantPart = Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string>[number];

export function isOpenAICompaction(part: AssistantPart) {
  if (part.type !== "custom" || part.kind !== "openai.compaction") return false;
  const options = part.providerOptions?.openai;
  return typeof options?.itemId === "string" && options.itemId.length > 0
    && typeof options.encryptedContent === "string" && options.encryptedContent.length > 0;
}

/** Restore provider order without duplicating commentary in the visible transcript. */
export function replayModelMessages(rows: AgentMessage[]): ModelMessage[] {
  const byId = new Map(rows.map(row => [row.id, row.message]));
  const referenced = new Set<string>();
  const restored = new Set<AssistantPart>();
  const messages = rows.map(({ message }): ModelMessage => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return message;
    const content = message.content.flatMap((part): AssistantPart[] => {
      if (part.type !== "custom" || part.kind !== PERSISTED_COMMENTARY_KIND) return [part];
      const id = part.providerOptions?.wdyt?.messageId;
      const saved = typeof id === "string" ? byId.get(id) : undefined;
      if (typeof id !== "string" || saved?.role !== "assistant" || !Array.isArray(saved.content)) {
        throw new Error("Saved agent commentary is missing from the conversation context.");
      }
      referenced.add(id);
      for (const part of saved.content) restored.add(part);
      return saved.content;
    });
    return { ...message, content };
  });
  const replay = messages.filter((_, index) => !referenced.has(rows[index].id));
  // Older rows saved commentary early without a position marker. Keep its text
  // inline, but omit the provider identity that requires reasoning to precede it.
  // The durable transcript and encrypted reasoning remain intact.
  return replay.map(message => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return message;
    if (message.content.some(part => restored.has(part))) return message;
    if (!message.content.every(part => part.type === "text" && part.providerOptions?.openai?.phase === "commentary")) return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== "text") return part;
      const { itemId: _itemId, ...openai } = part.providerOptions?.openai ?? {};
      return { ...part, providerOptions: { ...part.providerOptions, openai } };
    }) };
  });
}

/** Only shorten model input. Never delete the durable transcript or action audit. */
export function compactModelMessages(messages: ModelMessage[], provider: "openai" | "anthropic" | "meta" | "google"): ModelMessage[] {
  if (provider !== "openai") {
    // An OpenAI checkpoint cannot replace another provider's conversation history.
    return messages.flatMap((message): ModelMessage[] => {
      if (message.role !== "assistant" || !Array.isArray(message.content)) return [message];
      const content = message.content.filter(part => part.type !== "custom" || part.kind !== "openai.compaction");
      return content.length ? [{ ...message, content }] : [];
    });
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const checkpoint = message.content.findLastIndex(isOpenAICompaction);
    if (checkpoint < 0) continue;
    const compacted: ModelMessage[] = [
      ...messages.slice(0, index).filter(item => item.role === "system"),
      { ...message, content: message.content.slice(checkpoint) },
      ...messages.slice(index + 1),
    ];
    // A checkpoint may arrive between a call and its result. Keep that input
    // intact; OpenAI still compacts it server-side. Never send orphan tool results.
    const calls = new Set<string>();
    for (const item of compacted) {
      if (!Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part.type === "tool-call") calls.add(part.toolCallId);
        if (part.type === "tool-result" && !calls.has(part.toolCallId)) return messages;
      }
    }
    return compacted;
  }
  return messages;
}
