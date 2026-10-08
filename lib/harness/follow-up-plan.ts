import type { AgentRun } from "./types";

/** Saved with the execution step so replay takes the same follow-up branches. */
export function agentFollowUpPlan(run: Pick<AgentRun, "status" | "metadata" | "result"> | null) {
  return {
    attention: Boolean(run && !run.metadata.automaticPause && (run.status === "awaiting_approval" || run.status === "paused")),
    scheduled: Boolean(run?.metadata.scheduleExecution),
    completion: Boolean(run?.status === "done" && run.metadata.responseDisposition !== "silent"
      && run.metadata.responseDisposition !== "reaction" && run.result?.outcome !== "needs_user"),
    failedWait: Boolean(run?.status === "failed" && typeof run.metadata.pauseDispatchId === "string"),
  };
}
