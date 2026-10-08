import assert from 'node:assert/strict';
import test from 'node:test';
import { ThreadCache } from '../app/thread-cache';
const items = [{ id: 'm1', kind: 'agent' as const, text: 'The full conversation is here.' }];
function storage() {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
}
test('cached messages survive reopening, remain account scoped, and clear on sign out', async () => {
  const saved = storage(); const first = new ThreadCache('one', saved);
  first.set('run', items);
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.deepEqual(new ThreadCache('one', saved).get('run'), items);
  assert.equal(new ThreadCache('two', saved).size, 0);
  first.clearSaved();
  assert.equal(new ThreadCache('one', saved).size, 0);
});
test('prefetch and opening share one request, and late responses cannot restore signed-out history', async () => {
  const original = globalThis.fetch; let requests = 0; let finish!: (response: Response) => void;
  globalThis.fetch = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const saved = storage(); const cache = new ThreadCache('one', saved);
  try {
    const prefetch = cache.load('run'); const opening = cache.load('run');
    assert.equal(prefetch, opening); assert.equal(requests, 1);
    cache.clearSaved(); finish(Response.json({ items }));
    await opening;
    assert.equal(cache.size, 0);
    assert.equal(new ThreadCache('one', saved).size, 0);
  } finally { globalThis.fetch = original; }
});
test('failed refresh preserves cached history and can retry', async () => {
  const original = globalThis.fetch; const cache = new ThreadCache('one', storage()); cache.set('run', items);
  try {
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(cache.load('run'));
    assert.deepEqual(cache.get('run'), items);
    globalThis.fetch = async () => Response.json({ items: [...items, { id: 'm2', kind: 'user', text: 'thanks' }] });
    assert.equal((await cache.load('run')).length, 2);
  } finally { globalThis.fetch = original; cache.clearSaved(); }
});

test('more than 30 chats and large transcripts reopen synchronously after restarting', () => {
  const saved = storage(); const first = new ThreadCache('many', saved);
  first.set('long', [{ id: 'long', kind: 'agent', text: 'a'.repeat(1_100_000) }]);
  for (let i = 0; i < 45; i++) first.set(`run-${i}`, items);
  assert.deepEqual(first.get('run-0'), items);
  const reopened = new ThreadCache('many', saved);
  for (let i = 0; i < 45; i++) assert.deepEqual(reopened.get(`run-${i}`), items);
  assert.equal(reopened.get('long')?.[0].kind, 'agent');
  first.clearSaved();
  assert.equal(new ThreadCache('many', saved).get('run-0'), undefined);
  assert.equal(new ThreadCache('many', saved).get('long'), undefined);
});
test('newer per-chat saves take precedence over the legacy cache', () => {
  const saved = storage(); saved.setItem('wdyt-threads-v1:one', JSON.stringify([['run', items]]));
  const newer = [...items, { id: 'm2', kind: 'agent' as const, text: 'New reply' }];
  new ThreadCache('one', saved).set('run', newer);
  assert.deepEqual(new ThreadCache('one', saved).get('run'), newer);
});
test('live arrival notifies the open chat and cannot be replaced by an older in-flight refresh', async () => {
  const original = globalThis.fetch; let finish!: (response: Response) => void;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const cache = new ThreadCache('one', storage()); cache.set('run', items);
  let notified = 0; const unsubscribe = cache.subscribe('run', () => notified++);
  try {
    const refresh = cache.load('run');
    const live = [...items, { id: 'm2', kind: 'agent' as const, text: 'Just arrived' }];
    cache.set('run', live); assert.equal(notified, 1);
    finish(Response.json({ items }));
    assert.deepEqual(await refresh, live);
    assert.deepEqual(cache.get('run'), live);
    unsubscribe(); cache.set('run', live); assert.equal(notified, 1);
  } finally { globalThis.fetch = original; cache.clearSaved(); }
});
test('Home prefetch skips already refreshed chats when another conversation changes', async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ items }); };
  const cache = new ThreadCache('one', storage());
  try {
    await cache.prefetch('one', '1'); await cache.prefetch('two', '1');
    await cache.prefetch('one', '1'); await cache.prefetch('two', '2');
    assert.equal(requests, 3);
  } finally { globalThis.fetch = original; cache.clearSaved(); }
});
