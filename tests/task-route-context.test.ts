import assert from "node:assert/strict";
import test from "node:test";
import { resolveTaskRoute } from "../app/task-route-context";
import { historyFromRun, taskFromRun } from "../app/workspace-model";
import type { AgentRunSnapshot } from "../lib/harness/types";
import type { Decision } from "../lib/types";

const completed: AgentRunSnapshot = {
  id: "run-stripe", decisionId: "discovery-stripe", userId: "test@example.com",
  title: "Choose how to handle the dispute", category: "money", request: "Check the dispute",
  status: "done", response: "The dispute is still open.", result: null, error: null,
  createdAt: "2026-09-07T23:35:00Z", updatedAt: "2026-09-08T00:35:00Z", completedAt: "2026-09-08T00:35:00Z",
  metadata: {}, actions: [], artifacts: [],
  threadItems: [{ id: "old-message", kind: "agent", text: "The dispute is still open." }],
};
const active: AgentRunSnapshot = {
  ...completed, status: "running", completedAt: null, updatedAt: "2026-09-08T01:59:00Z",
  threadItems: [...completed.threadItems!, { id: "follow-up", kind: "user", text: "So whats the status right now", createdAt: "2026-09-08T01:59:00Z" }],
};

test("a delayed follow-up keeps its run when the old history row is removed", () => {
  for (const id of ["failed-discovery-stripe", "history-discovery-stripe-123", "completed-run-stripe"]) {
    const entry = { ...historyFromRun(completed), id };
    const before = resolveTaskRoute({ id, decisions: [], tasks: [], history: [entry], snapshots: new Map() });
    assert.equal(before.resolvedRunId, completed.id);
    const binding = { routeId: id, runId: before.resolvedRunId! };
    const after = resolveTaskRoute({ id, binding, decisions: [], tasks: [taskFromRun(active)], history: [], snapshots: new Map([[active.id, active]]) });
    assert.equal(after.runId, completed.id, "the history-row ID must never become an API run ID");
    assert.equal(after.task?.title, completed.title);
    assert.equal(after.task?.category, "money");
    assert.deepEqual(after.snapshot?.threadItems, active.threadItems);
    const finished = resolveTaskRoute({ id, binding, decisions: [], tasks: [], history: [historyFromRun(completed)], snapshots: new Map([[completed.id, completed]]) });
    assert.equal(finished.runId, completed.id);
    assert.equal(finished.entry?.title, completed.title);
  }
});

test("background history normalization and temporary row gaps retain the open transcript", () => {
  const id = "failed-discovery-stripe";
  const binding = { routeId: id, runId: completed.id };
  const snapshots = new Map([[completed.id, completed]]);
  for (const history of [[], [historyFromRun(completed)]]) {
    const route = resolveTaskRoute({ id, binding, decisions: [], tasks: [], history, snapshots });
    assert.equal(route.runId, completed.id);
    assert.equal(route.snapshot?.title, completed.title);
    assert.deepEqual(route.snapshot?.threadItems, completed.threadItems);
  }
  const waitingForSnapshot = resolveTaskRoute({ id, binding, decisions: [], tasks: [], history: [], snapshots: new Map() });
  assert.equal(waitingForSnapshot.runId, completed.id, "message-cache lookup remains on the real run during refresh");
});

test("opening another conversation never inherits the previous route binding", () => {
  const route = resolveTaskRoute({ id: "another-run", binding: { routeId: "failed-discovery-stripe", runId: completed.id }, decisions: [], tasks: [taskFromRun(active)], history: [], snapshots: new Map([[completed.id, completed]]) });
  assert.equal(route.runId, "another-run");
  assert.equal(route.task, undefined);
  assert.equal(route.snapshot, undefined);
});

test("an explicit new run for the same decision replaces its older binding", () => {
  const next = { ...active, id: "new-run" };
  const decision = { id: completed.decisionId!, activeRunId: next.id } as Decision;
  const route = resolveTaskRoute({ id: decision.id, binding: { routeId: decision.id, runId: completed.id }, decisions: [decision], tasks: [taskFromRun(next)], history: [], snapshots: new Map([[completed.id, completed], [next.id, next]]) });
  assert.equal(route.runId, next.id);
  assert.equal(route.resolvedRunId, next.id);
  assert.equal(route.snapshot, next);
});

test("direct run aliases and unanswered decisions still resolve without a binding", () => {
  for (const id of [completed.id, `remote-${completed.id}`, `completed-${completed.id}`, `failed-${completed.id}`]) {
    const route = resolveTaskRoute({ id, decisions: [], tasks: [], history: [], snapshots: new Map([[completed.id, completed]]) });
    assert.equal(route.runId, completed.id);
    assert.equal(route.snapshot, completed);
  }
  const decision = { id: "unanswered" } as Decision;
  const route = resolveTaskRoute({ id: decision.id, decisions: [decision], tasks: [], history: [], snapshots: new Map() });
  assert.equal(route.decision, decision);
  assert.equal(route.runId, undefined);
});
