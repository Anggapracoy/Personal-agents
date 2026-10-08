import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { createGoogleToolRegistry } from "../lib/harness/google-tools";
import { loadPhoneTools } from "../lib/harness/phone";
import { RunStoppedError } from "../lib/harness/actions";

test("tool setup shares its snapshot but tool execution checks the current run", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "startup@example.test", decisionId: null, title: "Test", request: "Test", category: "test", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  await store.putSecret(run.id, "google_access_token", "fixture-token");
  const startupSnapshot = Promise.resolve(await store.getSnapshot(run.id));
  const getRun = store.getRun.bind(store);
  let reads = 0;
  store.getRun = async id => { reads++; return getRun(id); };
  const registry = await createGoogleToolRegistry({ runId: run.id, stepId: "turn", userId: run.userId, store, startupSnapshot });
  assert.equal(reads, 0);
  await store.updateRun(run.id, { status: "cancelled" });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected external request"); };
  try {
    const execute = registry.tools.gmail_search_messages.execute!;
    await assert.rejects(async () => execute({ query: "test", maxResults: 1 }, { toolCallId: "test", messages: [], context: {} }), RunStoppedError);
    assert.ok(reads > 0);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("phone setup uses the shared snapshot and retains unavailable-access behavior", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "startup@example.test", decisionId: null, title: "Test", request: "Test", category: "test", metadata: {} });
  const startupSnapshot = Promise.resolve(await store.getSnapshot(run.id));
  store.getSnapshot = async () => { throw new Error("Unexpected duplicate snapshot"); };
  const key = process.env.RESIA_API_KEY;
  process.env.RESIA_API_KEY = "fixture-key";
  try {
    assert.deepEqual(await loadPhoneTools({ runId: run.id, userId: run.userId, stepId: "turn", store, startupSnapshot }), {});
  } finally {
    if (key === undefined) delete process.env.RESIA_API_KEY;
    else process.env.RESIA_API_KEY = key;
  }
});
