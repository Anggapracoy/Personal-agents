import { createAnthropic } from "@ai-sdk/anthropic";

/** Preserve valid reasoning, but let Anthropic drop blocks whose prefix changed
 * after our browser-history compression or a new turn's dynamic instructions.
 * The installed SDK does not yet expose Sonnet 5.5's block_binding option.
 */
export function dashAnthropicModel(modelId: string, options: { apiKey?: string; fetch?: typeof fetch } = {}) {
  return createAnthropic({
    apiKey: options.apiKey,
    fetch: async (url, init) => {
      if (modelId !== "claude-sonnet-5-5") return (options.fetch ?? globalThis.fetch)(url, init);
      if (typeof init?.body !== "string") throw new Error("Expected a JSON Anthropic request.");
      const body = JSON.parse(init.body);
      if (body.thinking?.type === "adaptive") {
        body.thinking.block_binding = { prefix_mismatch_behavior: "drop_block" };
        const headers = new Headers(init.headers);
        const beta = headers.get("anthropic-beta");
        headers.set("anthropic-beta", [beta, "thinking-binding-controls-2026-08-01"].filter(Boolean).join(","));
        return (options.fetch ?? globalThis.fetch)(url, { ...init, headers, body: JSON.stringify(body) });
      }
      return (options.fetch ?? globalThis.fetch)(url, init);
    },
  })(modelId);
}
