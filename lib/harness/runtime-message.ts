import type { ModelMessage } from "ai";
import type { AgentRun } from "./types";

/** A device receipt can arrive while a model step is still executing other tools. */
export function hasUnreadRuntimeResult(run: Pick<AgentRun, "metadata"> | null | undefined) {
  return Number(run?.metadata.runtimeResultSeq ?? 0) > Number(run?.metadata.runtimeResultReadSeq ?? 0);
}
/** Inject at most once every eight minutes, starting eight minutes into the task. */
export function taskElapsedNote(startedAt: number, now = Date.now(), lastNotedAt?: number): ModelMessage[] {
  const minutes = Math.floor((now - startedAt) / 60_000);
  const sinceLastNote = now - (lastNotedAt ?? startedAt);
  return minutes >= 8 && sinceLastNote >= 8 * 60_000 ? [{ role: "user", content: `[runtime] This task has been running for ${minutes} minutes.` }] : [];
}

/** Runtime receipts can include an image; they are never a new user request. */
export function isRuntimeMessage(message: ModelMessage) {
  if (message.role !== "user") return false;
  const text = typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join("");
  return text.startsWith("[runtime]");
}
