import type { AgentMessage, AgentRun } from "./types";
import { activityIcon, type ActivityIconName } from "./tool-activity-icons";
import { activityLabel } from "./tool-activity-labels";
import { hasUnreadRuntimeResult } from "./runtime-message";

export function pendingSteering(run: Pick<AgentRun, "metadata"> | null | undefined): AgentMessage[] {
  return (run?.metadata.pendingSteering as AgentMessage[] | undefined) ?? [];
}

export const steeringInstructions = "User messages received while you work steer this same task. Incorporate corrections and new constraints immediately, preserving the original objective unless the user changes it. Use existing tool receipts; never repeat an action that already happened. A steering message does not itself grant new approval.";

/** Let an in-flight call settle, but do not start another call on stale input. */
export function steerableTools(tools: import("ai").ToolSet, store: import("./types").RunStore, runId: string, stopped: () => boolean = () => false, assertOwned: () => Promise<void> = async () => {}): import("ai").ToolSet {
  const active = new Map<string, { label: string; icon: ActivityIconName; startedAt: number }>();
  let writes = Promise.resolve();
  let latestStartedAt = 0;
  const publish = (activity: { label: string; icon: ActivityIconName; startedAt: number; finishedAt?: number } | null, browserUsed = false) => {
    // Parallel calls must not overwrite a newer activity with an older write.
    latestStartedAt = Math.max(latestStartedAt, activity?.startedAt ?? 0);
    const toolActivityAt = new Date(latestStartedAt).toISOString();
    writes = writes.then(async () => { await store.updateRunMetadata(runId, { toolActivity: activity, toolActivityAt, taskWorkStarted: true, ...(browserUsed ? { browserUsed: true } : {}) }); });
    return writes;
  };
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    return [name, !execute ? definition : { ...definition, execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
      if (stopped()) return { accepted: false, detail: "This turn has already ended." };
      await assertOwned();
      const run = await store.getRun(runId);
      if (pendingSteering(run).length) throw new Error("New user input is pending. Yield to steering before calling another tool.");
      if (hasUnreadRuntimeResult(run)) throw new Error("A new device result is ready. Yield so the runtime can load it before another tool call.");
      const activity = { icon: activityIcon(name, input && typeof input === "object" ? input as Record<string, unknown> : {}), label: activityLabel(name, input && typeof input === "object" ? input as Record<string, unknown> : {}), startedAt: Date.now() };
      active.set(options.toolCallId, activity);
      await publish(activity, name.startsWith("browser_"));
      try {
        return await execute(input, options);
      } finally {
        active.delete(options.toolCallId);
        await publish([...active.values()].at(-1) ?? { ...activity, finishedAt: Date.now() });
      }
    } }];
  }));
}
