import { phoneCallTerminal } from "./resia";
import type { AgentAction } from "./types";

export type CallSummary = { id: string; kind: "call"; createdAt?: string; recipient: string; durationSeconds?: number; failed: boolean };
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** Project the saved provider receipt, never the private call brief or raw transcript. */
export function callSummary(action: AgentAction, actions: AgentAction[] = []): CallSummary | null {
  if (action.toolName !== "phone_call" || action.status !== "executed" || !text(action.result?.callId)) return null;
  const saved = record(action.result?.callResult);
  const result = saved && phoneCallTerminal(saved.status) ? saved : actions.findLast(item => item.toolName === "phone_call_result" && item.status === "executed" && item.input.callId === action.result?.callId && phoneCallTerminal(item.result?.status))?.result;
  if (!result || !phoneCallTerminal(result.status)) return null;
  const request = record(action.input.request);
  const failed = result.status === "error" || result.status === "canceled";
  const started = Date.parse(text(result.started_at));
  const ended = Date.parse(text(result.ended_at));
  const durationSeconds = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? Math.round((ended - started) / 1000) : undefined;
  return {
    id: `call:${action.id}`, kind: "call", createdAt: action.createdAt ?? action.executedAt ?? undefined,
    recipient: text(request?.recipientName) || text(request?.phoneNumber) || "Phone call",
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    failed,
  };
}

/** Keep the completed panel at the call's original place, including after reload. */
export function includeCallSummaries<T extends { id: string; createdAt?: string }>(items: T[], actions: AgentAction[]): Array<T | CallSummary> {
  const summaries = actions.flatMap(action => { const summary = callSummary(action, actions); return summary ? [summary] : []; });
  const ids = new Set(summaries.map(item => item.id));
  const result: Array<T | CallSummary> = items.filter(item => !ids.has(item.id));
  for (const summary of summaries) {
    const startedAt = Date.parse(summary.createdAt ?? "");
    const next = Number.isFinite(startedAt) ? result.findIndex(item => Date.parse(item.createdAt ?? "") > startedAt) : -1;
    result.splice(next < 0 ? result.length : next, 0, summary);
  }
  return result;
}
