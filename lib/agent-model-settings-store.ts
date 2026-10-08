import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { agentModelSettingsSchema, defaultAgentModelSettings, installationModelSettings, type AgentModelSettings } from "./agent-model-settings";

export async function getAgentModelSettings(db = getDb()): Promise<AgentModelSettings> {
  const rows = await db.execute<{ value: Record<string, unknown>; revision: number }>(sql`select value, revision from app_feature_flags where key='agent_model'`);
  return installationModelSettings(rows[0] ? agentModelSettingsSchema.parse({ ...rows[0].value, modelId: rows[0].value.modelId === "gpt-5.6-terra" ? "gpt-6-sol" : rows[0].value.modelId, revision: rows[0].revision }) : { ...defaultAgentModelSettings });
}
