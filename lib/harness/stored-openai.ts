import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import { runtimeContextAfterHistory } from "./prompt-cache-layout";

/**
 * Store responses for diagnostics while replaying our durable history inline.
 * The adapter otherwise turns saved item IDs into server references, which fail
 * for pre-storage conversations and after OpenAI's retention window expires.
 * Its store=false conversion preserves encrypted reasoning and compaction; only
 * the final HTTP persistence flag changes. Our database remains the replay source.
 */
export function storedOpenAIModel(modelId: string, options: { apiKey?: string; fetch?: typeof fetch } = {}) {
  const provider = createOpenAI({
    apiKey: options.apiKey,
    fetch: async (url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON OpenAI Responses request.");
      const body = JSON.parse(init.body);
      body.store = true;
      return (options.fetch ?? globalThis.fetch)(url, { ...init, body: JSON.stringify(body) });
    },
  });
  return wrapLanguageModel({
    model: provider(modelId),
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        prompt: runtimeContextAfterHistory(params.prompt),
        providerOptions: {
          ...params.providerOptions,
          openai: { ...params.providerOptions?.openai, store: false },
        },
      }),
    },
  });
}
