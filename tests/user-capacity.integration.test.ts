import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { acquireUserCapacity } from '../lib/harness/user-capacity';
import { consumeApiQuota } from '../lib/api-quota';

const url = process.env.CAPACITY_TEST_DATABASE_URL;
test('PostgreSQL fences capacity across workers, recovers crashes, and enforces shared request quotas', { skip: !url }, async () => {
  if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/dash_capacity_test') throw new Error('Dedicated local database required');
  const schema = `capacity_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  const a = postgres(url, { max: 8, connection: { search_path: schema } });
  const b = postgres(url, { max: 8, connection: { search_path: schema } });
  try {
    await a.unsafe(await readFile(new URL('../db/migrations/0022_user_execution_capacity.sql', import.meta.url), 'utf8'));
    await a.unsafe(await readFile(new URL('../db/migrations/0021_security_boundaries.sql', import.meta.url), 'utf8'));
    let now = 0;
    const slots = await Promise.all(Array.from({ length: 24 }, (_, i) => acquireUserCapacity('same@example.invalid', i % 2 ? a : b, () => now)));
    const admitted = slots.filter(slot => slot !== null);
    assert.equal(admitted.length, 4);
    const other = await acquireUserCapacity('other@example.invalid', b, () => now);
    assert.ok(other);
    now = 30_000;
    await Promise.all(admitted.map(slot => slot.assertOwned()));
    now = 120_001;
    assert.equal(await acquireUserCapacity('same@example.invalid', b, () => now), null);
    now = 150_001;
    const replacement = await acquireUserCapacity('same@example.invalid', b, () => now);
    assert.ok(replacement);
    await assert.rejects(admitted[0].assertOwned(), /expired/);
    await Promise.all(admitted.map(slot => slot.release()));
    now += 20_001;
    await replacement.assertOwned();
    await replacement.release();
    await other.release();
    assert.equal((await a`select * from agent_user_slots`).length, 0);
    for (const [kind, limit] of [['run', 4], ['scan', 1], ['upload', 5]] as const) {
      const results = await Promise.all(Array.from({ length: 24 }, (_, i) => consumeApiQuota('same@example.invalid', kind, i % 2 ? a : b, 0)));
      assert.equal(results.filter(result => result.allowed).length, limit);
    }
  } finally {
    await a.end(); await b.end();
    await admin.unsafe(`drop schema ${schema} cascade`); await admin.end();
  }
});
