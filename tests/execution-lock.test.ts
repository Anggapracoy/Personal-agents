import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { MemoryRunStore, PostgresRunStore } from '../lib/harness/store';
import { runAgent } from '../lib/harness/run';
import { assertExecutionOwnership, coalesceOwnershipCheck, withExecutionOwnership } from '../lib/harness/execution-lock';
import { preloadAgentModel } from '../lib/harness/preload-model';

function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('context preparation is forwarded after module loading and before the first turn', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'test', decisionId: null, category: 'test', request: 'test', title: 'test', metadata: {} });
  const loaded = gate();
  const events: string[] = [];
  const model = preloadAgentModel(async () => {
    await loaded.promise;
    return {
      prepare(value) { assert.equal(value.id, run.id); events.push('prepare'); },
      async turn() { events.push('turn'); },
    };
  });
  model.prepare?.(run);
  const turn = model.turn({ run, turnId: 'test', onNarration: async () => {} });
  assert.deepEqual(events, []);
  loaded.resolve();
  await turn;
  assert.deepEqual(events, ['prepare', 'turn']);
});

test('completed runs do not prefetch context or enter the model', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'test', decisionId: null, category: 'test', request: 'test', title: 'test', metadata: {} });
  await store.updateRun(run.id, { status: 'done' });
  await runAgent({ runId: run.id, store, model: {
    prepare() { assert.fail('terminal context prepared'); },
    async turn() { assert.fail('terminal model called'); },
  } });
});

test('the heartbeat result still stops a run cancelled during worker setup', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'test', decisionId: null, category: 'test', request: 'test', title: 'test', metadata: {} });
  const update = store.updateRunMetadata.bind(store);
  store.updateRunMetadata = async (id, patch, through) => {
    if (patch.workerHeartbeatAt) await store.updateRun(id, { status: 'cancelled' });
    return update(id, patch, through);
  };
  let turns = 0;
  await runAgent({ runId: run.id, store, model: { async turn() { turns++; } } });
  assert.equal(turns, 0);
  assert.equal((await store.getRun(run.id))?.status, 'cancelled');
});

test('failed parallel heartbeat writes release every acquired capacity slot', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'heartbeat-failure@test.invalid', decisionId: null, category: 'test', request: 'test', title: 'test', metadata: {} });
  const update = store.updateRunMetadata.bind(store);
  store.updateRunMetadata = async (id, patch, through) => {
    if (patch.workerHeartbeatAt) throw new Error('heartbeat storage failed');
    return update(id, patch, through);
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(runAgent({ runId: run.id, store, model: { async turn() { assert.fail('uninitialized worker ran'); } } }), /heartbeat storage failed/);
  }
  store.updateRunMetadata = update;
  let turns = 0;
  await runAgent({ runId: run.id, store, model: { async turn() { turns++; } } });
  assert.equal(turns, 1);
});

test('concurrent ownership checks share only the in-flight probe and recheck after settlement', async () => {
  const pending = gate();
  let calls = 0;
  const check = coalesceOwnershipCheck(async () => {
    calls++;
    if (calls === 1) await pending.promise;
    else throw new Error('lock lost');
  });
  const first = check(), second = check();
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve();
  await Promise.all([first, second]);
  const failures = await Promise.allSettled([check(), check()]);
  assert.equal(calls, 2);
  assert.ok(failures.every(value => value.status === 'rejected' && /lock lost/.test(String(value.reason))));
  await assert.rejects(check(), /lock lost/);
  assert.equal(calls, 3);
});

test('model loading overlaps lock acquisition but a denied worker never starts a turn', async () => {
  const ready = gate(), lockChecked = gate();
  const store = new MemoryRunStore();
  let turns = 0, disposals = 0;
  const model = preloadAgentModel(async () => {
    await ready.promise;
    return { async turn() { turns++; }, async dispose() { disposals++; } };
  });
  store.withExecutionLock = async () => { lockChecked.resolve(); return { acquired: false }; };
  const result = runAgent({ runId: 'denied', store, model });
  await lockChecked.promise;
  assert.equal(turns, 0);
  ready.resolve();
  assert.deepEqual(await result, { retryAfterMs: 5000 });
  assert.equal(turns, 0);
  assert.equal(disposals, 1);
});

test('a preloaded model reports import failure and releases the execution lock', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'test', decisionId: null, category: 'test', request: 'test', title: 'test', metadata: {} });
  const model = preloadAgentModel(async () => { throw new Error('model import failed'); });
  await assert.rejects(runAgent({ runId: run.id, store, model }), /model import failed/);
  assert.equal((await store.getRun(run.id))?.status, 'failed');
  assert.equal((await store.withExecutionLock(run.id, async () => true)).acquired, true);
});

test('duplicate workers cannot enter the same turn; unrelated runs remain independent', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'test', decisionId: null, category: 'test', request: 'test', title: 'test', metadata: {} });
  const started = gate(), finish = gate();
  const first = runAgent({ runId: run.id, store, model: { async turn({ onNarration }) { started.resolve(); await finish.promise; await onNarration('Finished'); } } });
  await started.promise;
  let calls = 0, disposed = 0;
  try {
    const duplicate = await runAgent({ runId: run.id, store: new MemoryRunStore(), model: { async turn() { calls++; }, async dispose() { disposed++; } } });
    assert.deepEqual(duplicate, { retryAfterMs: 5000 });
    assert.equal(calls, 0); assert.equal(disposed, 1);
    assert.deepEqual(await store.withExecutionLock('unrelated', async () => 'ok'), { acquired: true, value: 'ok' });
  } finally { finish.resolve(); await first; }
  assert.deepEqual(await store.withExecutionLock(run.id, async () => 'released'), { acquired: true, value: 'released' });
});

test('execution locks release after exceptions and stale ownership checks fail', async () => {
  const store = new MemoryRunStore(); let stale!: () => Promise<void>;
  await assert.rejects(store.withExecutionLock('failure', async check => { stale = check; throw Error('failed'); }), /failed/);
  await assert.rejects(stale(), /lock lost/);
  assert.equal((await store.withExecutionLock('failure', async () => true)).acquired, true);
  await assert.rejects(withExecutionOwnership(stale, assertExecutionOwnership), /lock lost/);
});

const url = process.env.EXECUTION_LOCK_TEST_DATABASE_URL;
test('PostgreSQL excludes independent connections and releases transaction locks on failure', { skip: !url }, async () => {
  // Advisory locks only: no application rows, schemas, or browser sessions touched.
  const a = postgres(url!, { prepare: false }), b = postgres(url!, { prepare: false });
  const firstStore = new PostgresRunStore(url!, a), secondStore = new PostgresRunStore(url!, b);
  const id = `lock-test-${crypto.randomUUID()}`, entered = gate(), finish = gate();
  const first = firstStore.withExecutionLock(id, async check => { await check(); entered.resolve(); await finish.promise; throw Error('intentional failure'); });
  const failure = assert.rejects(first, /intentional failure/);
  try {
    await entered.promise;
    assert.deepEqual(await secondStore.withExecutionLock(id, async () => { throw Error('duplicate entered'); }), { acquired: false });
    assert.equal((await secondStore.withExecutionLock(id + '-other', async () => true)).acquired, true);
    finish.resolve(); await failure;
    assert.deepEqual(await secondStore.withExecutionLock(id, async check => { await check(); return 'recovered'; }), { acquired: true, value: 'recovered' });
  } finally { finish.resolve(); await failure; await Promise.all([a.end(), b.end()]); }
});
