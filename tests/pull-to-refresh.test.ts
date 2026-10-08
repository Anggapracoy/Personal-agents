import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPullToRefresh, type RefreshState } from '../app/pull-to-refresh';
class Surface extends EventTarget {
  scrollTop = 0;
  closest() { return null; }
  touch(type: string, x: number, y: number, count = 1) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })) });
    this.dispatchEvent(event); return event;
  }
}
test('release threshold refreshes once and settles only after the request', async () => {
  const node = new Surface(); let calls = 0; let finish!: () => void;
  let state: RefreshState | undefined;
  const control = attachPullToRefresh(node as unknown as HTMLElement, () => { calls++; return new Promise(resolve => { finish = resolve; }); }, value => { state = value; }, 0);
  node.touch('touchstart', 100, 100); const move = node.touch('touchmove', 102, 280);
  assert.equal(move.defaultPrevented, true); assert.equal(calls, 0);
  node.touch('touchend', 102, 280); assert.equal(calls, 1); assert.equal(state?.refreshing, true);
  node.touch('touchstart', 100, 100); node.touch('touchmove', 100, 300); node.touch('touchend', 100, 300);
  assert.equal(calls, 1); finish(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(state?.refreshing, false); assert.equal(state?.distance, 0); control.dispose();
});
test('short pulls, horizontal gestures, scrolled content and cancellation do not refresh', () => {
  const node = new Surface(); let calls = 0;
  const control = attachPullToRefresh(node as unknown as HTMLElement, async () => { calls++; }, () => {});
  node.touch('touchstart', 100, 100); node.touch('touchmove', 100, 140); node.touch('touchend', 100, 140);
  node.touch('touchstart', 100, 100); assert.equal(node.touch('touchmove', 200, 110).defaultPrevented, false); node.touch('touchend', 200, 110);
  node.scrollTop = 20; node.touch('touchstart', 100, 100); node.touch('touchmove', 100, 300); node.touch('touchend', 100, 300);
  node.scrollTop = 0; node.touch('touchstart', 100, 100); node.touch('touchmove', 100, 300); node.touch('touchcancel', 100, 300); node.touch('touchend', 100, 300);
  assert.equal(calls, 0); control.dispose();
});
test('failed refresh retains a short error; disposal ignores a late response', async () => {
  const node = new Surface(); let state: RefreshState | undefined;
  const control = attachPullToRefresh(node as unknown as HTMLElement, async () => { throw new Error('private server exception'); }, value => { state = value; }, 0);
  await control.refresh(); assert.equal(state?.refreshing, false); assert.equal(state?.error, 'Couldn’t refresh. Pull down to try again.');
  control.dispose(); state = undefined; await control.refresh(); assert.equal(state, undefined);
});
test('Home refresh reads saved data without invoking scanning or run mutations', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../app/workspace.tsx', import.meta.url), 'utf8');
  const refresh = source.split('const refreshConversations = async () => {')[1].split('// Scheduled work can wake')[0];
  assert.match(refresh, /store.refresh\(\)/);
  assert.match(refresh, /conversationSettings.refresh\(\)/);
  assert.match(refresh, /api\/schedules\/updates/);
  assert.doesNotMatch(refresh, /refreshFeed|startRun|rescan|method:\s*['"](?:POST|PUT|PATCH)/);
});

test('a fast refresh keeps its indicator visible for the configured minimum', async () => {
  const node = new Surface(); let state: RefreshState | undefined;
  const control = attachPullToRefresh(node as unknown as HTMLElement, async () => {}, value => { state = value; }, 40);
  const done = control.refresh();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(state?.refreshing, true);
  await done;
  assert.equal(state?.refreshing, false);
  control.dispose();
});
