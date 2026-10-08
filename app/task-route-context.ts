import type { AgentRunSnapshot } from "../lib/harness/types";
import type { Decision, HistoryEntry, RunningTask } from "../lib/types";
import { runRouteMatches, sortedHistory } from "./workspace-model";

export type TaskRouteBinding = { routeId: string; runId: string };

/** A list row may disappear on reply; the open conversation still owns its run. */
export function resolveTaskRoute({ id, decisions, tasks, history, snapshots, binding }: {
  id: string;
  decisions: Decision[];
  tasks: RunningTask[];
  history: HistoryEntry[];
  snapshots: Map<string, AgentRunSnapshot>;
  binding?: TaskRouteBinding | null;
}) {
  const boundRunId = binding?.routeId === id ? binding.runId : undefined;
  const decision = decisions.find(item => item.id === id);
  const task = tasks.find(item => item.id === id || runRouteMatches(id, item.runId) || item.decisionId === id || (decision?.activeRunId !== undefined && item.runId === decision.activeRunId))
    ?? (boundRunId ? tasks.find(item => item.runId === boundRunId) : undefined);
  const entry = history.find(item => item.id === id)
    ?? history.find(item => runRouteMatches(id, item.runId))
    ?? (decision ? undefined : sortedHistory(history).find(item => item.decisionId === id))
    ?? (boundRunId ? history.find(item => item.runId === boundRunId) : undefined);
  const retainedSnapshot = [...snapshots.values()].find(item => runRouteMatches(id, item.id))
    ?? (boundRunId ? snapshots.get(boundRunId) : undefined);
  const resolvedRunId = task?.runId ?? decision?.activeRunId ?? entry?.runId ?? retainedSnapshot?.id;
  const runId = resolvedRunId ?? boundRunId ?? (!decision && !entry ? id : undefined);
  return { decision, task, entry, runId, resolvedRunId, snapshot: runId ? snapshots.get(runId) : undefined };
}
