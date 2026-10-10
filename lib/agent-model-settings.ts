import { z } from "zod";

export const agentModelSettingsSchema = z.object({
  modelId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:/-]+$/),
  provider: z.enum(['openai', 'anthropic', 'meta', 'google']).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]),
  fastMode: z.boolean().default(false),
  revision: z.number().int().nonnegative(),
});
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>;
export const defaultAgentModelSettings: AgentModelSettings = { modelId: "gemini-3.7-flash", provider: "google", reasoningEffort: "medium", fastMode: false, revision: 0 };
export function agentModelMetadata(settings: AgentModelSettings) {
  return { modelProvider: settings.provider ?? (settings.modelId.startsWith("gemini-") ? "google" as const : settings.modelId === "muse-spark-1.3" ? "meta" as const : settings.modelId.startsWith("claude-") ? "anthropic" as const : "openai" as const), modelId: settings.modelId, reasoningEffort: settings.reasoningEffort, fastMode: settings.modelId === "gpt-6-luna" && settings.fastMode };
}

export function installationModelSettings(saved: AgentModelSettings): AgentModelSettings {
  const modelId = process.env.DASH_AGENT_MODEL_ID?.trim() || process.env.OPENAI_AGENT_MODEL?.trim();
  if (!modelId) return saved;
  return agentModelSettingsSchema.parse({ ...saved, modelId,
    provider: process.env.DASH_AGENT_MODEL_ID?.trim() ? (process.env.DASH_AGENT_PROVIDER?.trim() || 'openai') : 'openai',
  });
}
