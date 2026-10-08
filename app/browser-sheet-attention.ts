import type { RunningTask } from "../lib/types";
import type { AgentRunSnapshot } from "../lib/harness/types";

export type BrowserSheetAttention = {
  actionId?: string;
  agentMessageIds: string[];
  openedAt: number;
};

export function shouldCloseBrowserForAttention(
  opened: BrowserSheetAttention,
  task: RunningTask | undefined,
  snapshot: AgentRunSnapshot | undefined,
  controllingBrowser = false,
) {
  if (task?.status === "needs_approval" && task.actionId && task.actionId !== opened.actionId) {
    if (controllingBrowser && task.approvalKind === "takeover") return false;
    return true;
  }
  return snapshot?.threadItems?.some(item => item.kind === "agent"
    && !opened.agentMessageIds.includes(item.id)
    && (!item.createdAt || Date.parse(item.createdAt) >= opened.openedAt - 1_000)) ?? false;
}
