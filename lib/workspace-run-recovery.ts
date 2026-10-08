import type { AgentRun, AgentAction } from './harness/types';
import type { WorkspaceStateData, RunningTask, Category } from './types';
import { appleOperationIsRead } from './apple/catalog';

export type RecoverableRun = Pick<AgentRun, "id" | "decisionId" | "category" | "title" | "request" | "status" | "metadata" | "updatedAt"> & { pendingAction?: Pick<AgentAction, "id" | "toolName" | "input" | "preview"> | null };

export function recoverWorkspaceRuns(state: WorkspaceStateData, runs: RecoverableRun[]): WorkspaceStateData {
  const known = new Set([...state.tasks, ...state.history].flatMap(item => item.runId ? [item.runId] : []));
  const decisions = new Set(state.decisions.flatMap(item => item.activeRunId ? [item.activeRunId] : []));
  const discarded = new Set(state.discardedDecisionIds);
  const recovered: RunningTask[] = [];
  for (const run of runs) {
    if (run.status === 'cancelled') continue;
    if (known.has(run.id) || decisions.has(run.id) || discarded.has(run.decisionId ?? run.id)) continue;
    const action = run.pendingAction;
    const device = run.status === 'awaiting_approval' && action?.toolName === 'apple_device';
    recovered.push({ id: `remote-${run.id}`, runId: run.id, decisionId: run.decisionId ?? run.id,
      category: run.category as Category, title: run.title, subtitle: device ? 'Waiting for your iPhone' : '',
      // Non-device recovery must stay subscribed until the full snapshot supplies its pause/question controls.
      status: device ? 'waiting' : 'running', updatedAt: run.updatedAt,
      chosenOption: String(run.metadata.userMessage ?? run.request), originalContext: run.request,
      ...(device ? { actionId: action.id, draft: action.preview, nativeAction: {
        operation: String(action.input.operation), parameters: action.input.parameters as Record<string, unknown> ?? {},
        readOnly: appleOperationIsRead(String(action.input.operation)),
      } } : {}),
    });
    known.add(run.id);
  }
  return recovered.length ? { ...state, tasks: [...recovered, ...state.tasks] } : state;
}
