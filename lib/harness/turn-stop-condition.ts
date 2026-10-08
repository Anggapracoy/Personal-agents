import { hasUnreadRuntimeResult } from "./runtime-message";
import { pendingSteering } from "./steering";
import type { RunStore } from "./types";

/** Continue tool steps without a count cap; yield only when the run needs to stop or reload context. */
export function agentTurnStopCondition(store: Pick<RunStore, "getRun">, runId: string, turnEnded: () => boolean) {
  // Keep an explicit condition: omitting stopWhen restores the SDK's one-step default.
  return async () => {
    const current = await store.getRun(runId);
    return turnEnded() || !current || current.status !== "running"
      || hasUnreadRuntimeResult(current) || pendingSteering(current).length > 0;
  };
}
