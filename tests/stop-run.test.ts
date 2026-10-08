import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRunStore } from "../lib/harness/store";
import { executeGuardedAction, RunStoppedError } from "../lib/harness/actions";

test("a stopped run takes no further actions", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "stop-test", decisionId: null, category: "social", request: "Book dinner", title: "Booking", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  let executed = 0;
  const act = () => executeGuardedAction({ runId: run.id, toolName: "browser_open", risk: "read", preview: "Open the reservation page", args: { url: "https://example.com" }, store, execute: async () => { executed += 1; return { ok: true }; } });
  await act();
  assert.equal(executed, 1);
  await store.updateRun(run.id, { status: "cancelled", completedAt: new Date().toISOString() });
  await assert.rejects(act(), RunStoppedError);
  assert.equal(executed, 1);
});
