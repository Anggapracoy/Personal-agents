import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineTimeline, reconcileInlineRecords } from '../app/inline-timeline';
const first = { id: 'first', createdAt: '2026-09-15T12:00:00Z' };
const reply = { id: 'reply', createdAt: '2026-09-15T12:02:00Z' };
const panel = { id: 'approval:1', node: null, summary: 'Earlier request', replaces: 'answers:1' };
const ids = (rows: ReturnType<typeof inlineTimeline>) => rows.map(row => 'item' in row ? row.item.id : row.panel.id);
test('pending, accepted, failed, and unrelated replies never move an existing panel below the new turn', () => {
  const records = reconcileInlineRecords([], [panel], [first], '2026-09-15T12:01:00Z');
  for (const active of [[panel], []]) {
    const updated = reconcileInlineRecords(records, active, [first, reply], '2026-09-15T12:03:00Z');
    assert.deepEqual(ids(inlineTimeline([first, reply], updated)), ['first', panel.id, 'reply']);
    assert.equal(updated[0].createdAt, records[0].createdAt);
  }
});
test('server replacement of an optimistic anchor uses the original timestamp', () => {
  const records = reconcileInlineRecords([], [panel], [first], '2026-09-15T12:01:00Z');
  assert.deepEqual(ids(inlineTimeline([{ ...first, id: 'server-first' }, reply], records)), ['server-first', panel.id, 'reply']);
});
test('answered questions replace the original panel once instead of appearing below the reply', () => {
  const records = reconcileInlineRecords([], [panel], [first], '2026-09-15T12:01:00Z');
  assert.deepEqual(ids(inlineTimeline([first, reply, { id: 'answers:1', createdAt: '2026-09-15T12:03:00Z' }], records)), ['first', panel.id, 'reply']);
});
test('multiple panels preserve their order and serializable history contains no live content', () => {
  const records = reconcileInlineRecords([], [panel, { id: 'failure:1', node: { secret: 'never persist this' } as never, summary: 'Earlier attempt failed.' }], [first], '2026-09-15T12:01:00Z');
  const restored = JSON.parse(JSON.stringify(records));
  assert.ok(!JSON.stringify(restored).includes('secret'));
  assert.deepEqual(ids(inlineTimeline([first, reply], restored)), ['first', panel.id, 'failure:1', 'reply']);
});
test('old generic approval history upgrades to one durable response at its original position', () => {
  const legacy = [{ id: 'approval:login', summary: 'Earlier request', createdAt: '2026-09-15T12:01:00Z', afterId: first.id }];
  const records = reconcileInlineRecords(legacy, [], [first, reply], '2026-09-15T12:03:00Z');
  assert.equal(records[0].summary, '');
  assert.equal(records[0].replaces, 'answers:login');
  assert.deepEqual(ids(inlineTimeline([first, reply, { id: 'answers:login' }], records)), ['first', 'approval:login', 'reply']);
});

test('completed evening calls stay after their time separator despite stale afternoon panel anchors', () => {
 const time = { id: 'call:1:time', createdAt: '2026-09-15T20:08:00Z' };
 const call = { id: 'call:1', createdAt: time.createdAt };
 const records = [{ id: 'pause:1', replaces: call.id, summary: 'Call ended', afterId: first.id, createdAt: first.createdAt }];
 assert.deepEqual(ids(inlineTimeline([first, time, call, { ...reply, createdAt: '2026-09-15T20:13:00Z' }], records)), ['first', time.id, 'pause:1', reply.id]);
});
