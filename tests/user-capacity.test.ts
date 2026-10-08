import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireUserCapacity } from '../lib/harness/user-capacity';
import { runAgent } from '../lib/harness/run';
import { MemoryRunStore } from '../lib/harness/store';
import type { AgentModel } from '../lib/harness/types';

test('capacity admits exactly four concurrent tasks per normalized owner and releases slots', async () => {
  const owner = `${crypto.randomUUID()}@example.invalid`;
  const slots = await Promise.all(Array.from({ length: 20 }, (_, i) => acquireUserCapacity(i % 2 ? owner.toUpperCase() : owner, null)));
  const admitted = slots.filter(slot => slot !== null);
  assert.equal(admitted.length, 4);
  const other = await acquireUserCapacity('other-' + owner, null);
  assert.ok(other);
  await admitted[0].release();
  const replacement = await acquireUserCapacity(owner, null);
  assert.ok(replacement);
  await Promise.all([...admitted, other, replacement].map(slot => slot.release()));
});

test('expired slots can be recovered without letting the old owner renew or delete its replacement', async () => {
  let now = 0;
  const owner = `${crypto.randomUUID()}@example.invalid`;
  const first = (await acquireUserCapacity(owner, null, () => now))!;
  now = 120_001;
  const replacement = (await acquireUserCapacity(owner, null, () => now))!;
  await assert.rejects(first.assertOwned(), /expired/);
  await first.release();
  now += 20_001;
  await replacement.assertOwned();
  await replacement.release();
});

test('a fifth run waits before model execution and runs when capacity is released', async () => {
  const owner = `${crypto.randomUUID()}@example.invalid`;
  const slots = await Promise.all(Array.from({ length: 4 }, () => acquireUserCapacity(owner, null)));
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: owner, decisionId: null, title: 'Test', category: 'social', request: 'Test', metadata: {} });
  let turns = 0, disposed = 0;
  const model: AgentModel = { async turn() { turns++; await store.updateRun(run.id, { status: 'done' }); }, async dispose() { disposed++; } };
  try {
    assert.deepEqual(await runAgent({ runId: run.id, store, model }), { retryAfterMs: 15_000 });
    assert.equal(turns, 0);
    assert.equal(disposed, 1);
    await slots[0]!.release();
    await runAgent({ runId: run.id, store, model });
    assert.equal(turns, 1);
    assert.equal(disposed, 2);
  } finally { await Promise.all(slots.map(slot => slot!.release())); }
});

test('failed model execution releases capacity for the next task', async () => {
  const owner = `${crypto.randomUUID()}@example.invalid`;
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: owner, decisionId: null, title: 'Test', category: 'social', request: 'Test', metadata: {} });
  await runAgent({ runId: run.id, store, model: { async turn() { throw new Error('test failure'); } } });
  const slots = await Promise.all(Array.from({ length: 4 }, () => acquireUserCapacity(owner, null)));
  try { assert.equal(slots.filter(Boolean).length, 4); }
  finally { await Promise.all(slots.map(slot => slot?.release())); }
});
