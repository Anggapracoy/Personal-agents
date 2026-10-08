import { z } from "zod";

export const agentModelSettingsSchema = z.object({
  modelId: z.enum(["muse-spark-1.3", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "claude-sonnet-5-5"]),
  reasoningEffort: z.enum(["low", "medium", "high"]),
  fastMode: z.boolean().default(false),
  revision: z.number().int().nonnegative(),
});
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>;
export const defaultAgentModelSettings: AgentModelSettings = { modelId: "gpt-6.1-sol", reasoningEffort: "low", fastMode: false, revision: 0 };
export function agentModelMetadata(settings: AgentModelSettings) {
  return { modelProvider: settings.modelId === "muse-spark-1.3" ? "meta" as const : settings.modelId === "claude-sonnet-5-5" ? "anthropic" as const : "openai" as const, modelId: settings.modelId, reasoningEffort: settings.reasoningEffort, fastMode: settings.modelId === "gpt-6-luna" && settings.fastMode };
}
