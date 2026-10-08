import { dispatchInteractiveRun } from "./dispatch";
import type { RunStore } from "./types";

/**
 * Continue a suspended or idle thread. The note is appended as a user-role
 * runtime message so the model sees what happened while it was paused
 * (approval granted, sign-in completed, answers given) and picks up from there.
 */
export async function resumeRun(store: RunStore, runId: string, note: string) {
  await store.appendMessages(runId, [{ role: "user", content: `[runtime] ${note}` }]);
  await store.updateRun(runId, { status: "running", error: null, completedAt: null });
  await dispatchInteractiveRun(runId);
}
