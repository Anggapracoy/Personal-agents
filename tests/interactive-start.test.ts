import assert from "node:assert/strict";
import test from "node:test";
import { prepareInteractiveStart } from "../lib/harness/interactive-start";
import { MemoryRunStore } from "../lib/harness/store";
import { runAgent } from "../lib/harness/run";

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test("connection preparation is best effort and cannot start execution before admission", async () => {
  let preparations = 0, turns = 0;
  class PreparedStore extends MemoryRunStore {
    async prepareConnections() { preparations++; throw new Error("temporary connection failure"); }
  }
  const store = new PreparedStore();
  const run = await store.createRun({ userId: "prepare@test.invalid", decisionId: null, category: "test", request: "Hi", title: "Hi", metadata: {} });
  let retained!: () => Promise<void>;
  const start = prepareInteractiveStart({ enabled: true, store: () => store, keepAlive: work => { retained = work; },
    load: async () => [{ createAgentModel: () => ({ async turn() { turns++; } }) }, { runAgent }],
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(preparations, 1);
  assert.equal(turns, 0);
  start(run.id);
  await retained();
  assert.equal(turns, 1, "a failed warm-up must not block normal execution");
});

test("local start and the durable worker cannot execute the same turn concurrently", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "local-start@test.invalid", decisionId: null, category: "test", request: "Hi", title: "Hi", metadata: {} });
  const started = gate(), finish = gate();
  let turns = 0;
  let retained: (() => Promise<void>) | undefined;
  const start = prepareInteractiveStart({ enabled: true, store: () => store,
    keepAlive: work => { retained = work; },
    load: async () => [{ createAgentModel: () => ({ async turn({ onNarration }) {
      turns++; started.resolve(); await finish.promise; await onNarration("Hello");
    } }) }, { runAgent }],
  });
  assert.equal(turns, 0, "preparation cannot start the model before admission");
  start(run.id);
  await started.promise;
  try {
    assert.deepEqual(await runAgent({ runId: run.id, store, model: { async turn() { turns++; } } }), { retryAfterMs: 5000 });
  } finally { finish.resolve(); await retained!(); }
  await runAgent({ runId: run.id, store, model: { async turn() { turns++; } } });
  assert.equal(turns, 1);
  assert.equal((await store.getRun(run.id))?.response, "Hello");
});

test("local lifetime registration failure leaves execution to the durable worker", async () => {
  let turns = 0;
  const start = prepareInteractiveStart({ enabled: true,
    keepAlive: () => { throw new Error("No request lifecycle"); },
    load: async () => [{ createAgentModel: () => ({ async turn() { turns++; } }) }, { runAgent }],
  });
  start("test");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(turns, 0);
});

test("disabled local start does not import or execute a worker", () => {
  prepareInteractiveStart({ enabled: false, load: async () => { assert.fail("worker imported"); } })("test");
});

test("local execution cannot publish a late answer after user cancellation", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "cancel-local@test.invalid", decisionId: null, category: "test", request: "Hi", title: "Hi", metadata: {} });
  let retained!: () => Promise<void>;
  const start = prepareInteractiveStart({ enabled: true, store: () => store, keepAlive: work => { retained = work; },
    load: async () => [{ createAgentModel: () => ({ async turn({ onNarration }) {
      await store.updateRun(run.id, { status: "cancelled" });
      await onNarration("Too late");
    } }) }, { runAgent }],
  });
  start(run.id);
  await retained();
  assert.equal((await store.getRun(run.id))?.status, "cancelled");
  assert.equal((await store.getRun(run.id))?.response, "");
});
