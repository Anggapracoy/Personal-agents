import type { AgentAction } from "./types";
import type { PauseDisplay } from "../pauses/definition";

export type WaitSummary = { id: string; kind: "wait"; createdAt?: string; reason: string; activePause?: PauseDisplay };

/** The saved pause receipt owns the wait's identity and original timeline position. */
export function waitSummary(action: AgentAction, activePause?: PauseDisplay): WaitSummary | null {
  const receipt = action.result;
  if (action.toolName !== "pause" || action.status !== "executed" || receipt?.saved !== true || typeof receipt.id !== "string" || receipt.eventKind === "phone_call" || receipt.phoneCall) return null;
  return {
    id: `wait:${receipt.id}`, kind: "wait",
    createdAt: action.createdAt ?? action.executedAt ?? undefined,
    reason: typeof receipt.reason === "string" ? receipt.reason : "",
    ...(activePause?.id === receipt.id ? { activePause } : {}),
  };
}

export function includeWaitSummaries<T extends { id: string; createdAt?: string }>(items: T[], actions: AgentAction[], activePause?: PauseDisplay): Array<T | WaitSummary> {
  const summaries = actions.flatMap(action => { const summary = waitSummary(action, activePause); return summary ? [summary] : []; });
  const ids = new Set(summaries.map(item => item.id));
  const result: Array<T | WaitSummary> = items.filter(item => !ids.has(item.id));
  for (const summary of summaries) {
    const startedAt = Date.parse(summary.createdAt ?? "");
    const next = Number.isFinite(startedAt) ? result.findIndex(item => Date.parse(item.createdAt ?? "") > startedAt) : -1;
    result.splice(next < 0 ? result.length : next, 0, summary);
  }
  return result;
}
