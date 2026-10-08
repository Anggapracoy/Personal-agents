import { assertExecutionOwnership } from "./execution-lock";
import type { LanguageModelMiddleware, ModelMessage } from "ai";
import type { RunStore } from "./types";
import { PERSISTED_COMMENTARY_KIND } from "./context-compaction";

/** Earlier browser work belongs to this opening only until a new user turn starts. */
export function openingAlreadySentForTurn(newUserTurn: boolean, assistantAfterUser: boolean, browserUsed: boolean) {
  return assistantAfterUser || (browserUsed && !newUserTurn);
}

/** Save provider commentary before the SDK executes the following tool call. */
export function createCommentaryPersistence(store: RunStore, runId: string, enabled: () => boolean, alreadyStarted = false) {
  let toolsStarted = alreadyStarted;
  let openingSaved = alreadyStarted;
  const saved: Array<{ text: string; messageId: string }> = [];
  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      // At most one visible message per model step; extra commentary in the same step is narration.
      let savedInStep = false;
      const text = new Map<string, { text: string; providerOptions?: Record<string, Record<string, import("ai").JSONValue | undefined>> }>();
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        async transform(part, controller) {
          if (part.type === "text-start") text.set(part.id, { text: "", providerOptions: part.providerMetadata });
          if (part.type === "text-delta") {
            const block = text.get(part.id);
            if (block) block.text += part.delta;
          }
          if (part.type === "text-end") {
            const block = text.get(part.id);
            text.delete(part.id);
            const providerOptions = part.providerMetadata ?? block?.providerOptions;
            // Every commentary message is shown: the opening, and the rare progress update on a long task.
            if (block?.text.trim() && providerOptions?.openai?.phase === "commentary" && enabled() && !savedInStep) {
              await assertExecutionOwnership();
              const [message] = await store.appendMessages(runId, [{ role: "assistant", content: [{ type: "text", text: block.text, providerOptions }] }]);
              saved.push({ text: block.text, messageId: message.id });
              savedInStep = true;
              openingSaved = true;
              await store.updateRunMetadata(runId, { taskWorkStarted: true });
            }
          }
          controller.enqueue(part);
        },
      })) };
    },
  };
  return {
    middleware,
    /** The SDK retains full messages for its next step; store each visible text only once. */
    remainingMessages(messages: ModelMessage[]): ModelMessage[] {
      const hasTools = messages.some(message => message.role === "assistant" && Array.isArray(message.content) && message.content.some(part => part.type === "tool-call"));
      const suppressStepText = hasTools && (toolsStarted || openingSaved);
      const remaining = messages.flatMap((message): ModelMessage[] => {
        if (message.role !== "assistant") return [message];
        if (typeof message.content === "string") return suppressStepText ? [] : [message];
        const content = message.content.flatMap((part): typeof message.content => {
          if (part.type !== "text") return [part];
          const isCommentary = part.providerOptions?.openai?.phase === "commentary";
          const index = saved.findIndex(item => item.text === part.text);
          if (index < 0) return suppressStepText || (isCommentary && (toolsStarted || openingSaved)) ? [] : [part];
          const [item] = saved.splice(index, 1);
          // Commentary is already visible in its own row. Keep its exact provider
          // position after reasoning and around checkpoints for saved-history replay.
          return [{ type: "custom", kind: PERSISTED_COMMENTARY_KIND, providerOptions: { wdyt: { messageId: item.messageId } } }];
        });
        return content.length ? [{ ...message, content }] : [];
      });
      if (hasTools) { toolsStarted = true; openingSaved = true; }
      saved.length = 0;
      return remaining;
    },
  };
}
