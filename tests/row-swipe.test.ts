import test from 'node:test';
import assert from 'node:assert/strict';
import { attachRowSwipe } from '../app/row-swipe';
class Surface extends EventTarget {
  style: Record<string, string> = {}; dataset: Record<string, string> = {};
  classList = { toggle() {} }; clientWidth = 390; inert = false; disabled = false;
  querySelector() { return null; }
  closest() { return null; } contains(node: unknown) { return node === this; } focus() {}
  getBoundingClientRect() { return { height: 88 }; }
  animate() { return { finished: Promise.resolve(), cancel() {} }; }
  touch(type: string, x: number, y = 100) {
    const e = new Event(type, { cancelable: true });
    Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }] });
    this.dispatchEvent(e); return e;
  }
}
test('row swipe touch intent, release, reversal, cancellation, and failed save recovery', async () => {
  const document = new EventTarget();
  const globals = { window: globalThis.window, document: globalThis.document, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  Object.assign(globalThis, { window: { matchMedia: () => ({ matches: true }) }, document, cancelAnimationFrame: () => {} });
  const row = new Surface(), front = new Surface(), action = new Surface(); let calls = 0;
  const dispose = attachRowSwipe(row as unknown as HTMLElement, front as unknown as HTMLElement, action as unknown as HTMLButtonElement, async () => { calls++; return false; });
  try {
    row.touch('touchstart', 320); assert.equal(row.touch('touchmove', 315, 170).defaultPrevented, false); row.touch('touchend', 315, 170);
    assert.equal(calls, 0); assert.equal(row.dataset.swipe, 'closed');
    row.touch('touchstart', 320); assert.equal(row.touch('touchmove', 240).defaultPrevented, true); row.touch('touchend', 240);
    assert.equal(action.inert, false); assert.equal(calls, 0); assert.match(front.style.transform, /-82px/);
    // Browsers synthesize a click after mouse dragging; it must not close the reveal.
    front.dispatchEvent(new Event('click', { cancelable: true })); assert.match(front.style.transform, /-82px/);
    row.touch('touchstart', 220); row.touch('touchmove', 320); row.touch('touchend', 320);
    assert.equal(row.dataset.swipe, 'closed'); assert.equal(calls, 0);
    row.touch('touchstart', 350); row.touch('touchmove', 30); assert.equal(calls, 0);
    row.touch('touchmove', 330); row.touch('touchend', 330); assert.equal(calls, 0);
    row.touch('touchstart', 350); row.touch('touchmove', 30); row.touch('touchcancel', 30); assert.equal(calls, 0);
    row.touch('touchstart', 350); row.touch('touchmove', 30); row.touch('touchend', 30);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 1); assert.equal(row.dataset.swipe, 'closed'); assert.equal(row.style.height, '');
    action.disabled = true; row.touch('touchstart', 350); row.touch('touchmove', 30); row.touch('touchend', 30);
    assert.equal(calls, 1);
  } finally { dispose(); Object.assign(globalThis, globals); }
});

test('settling row survives interrupted touches and repeated reverse/retry gestures', () => {
  const globals = { window: globalThis.window, document: globalThis.document, performance: globalThis.performance, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  let now = 0, id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  Object.assign(globalThis, {
    window: { matchMedia: () => ({ matches: false }) }, document: new EventTarget(),
    performance: { now: () => now },
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (frame: number) => frames.delete(frame),
  });
  const row = new Surface(), front = new Surface(), action = new Surface(); let calls = 0;
  const dispose = attachRowSwipe(row as unknown as HTMLElement, front as unknown as HTMLElement, action as unknown as HTMLButtonElement, async () => { calls++; return true; });
  const x = () => Number(front.style.transform.match(/translate3d\(([-\d.]+)px/)![1]);
  const tick = () => { now += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); assert.ok(x() <= 0 && x() >= -390, `row escaped its bounds: ${x()}`); };
  const settle = () => { for (let i = 0; frames.size && i < 150; i++) tick(); assert.equal(frames.size, 0); };
  const touch = (type: string, px: number) => { now += 20; row.touch(type, px); };
  try {
    touch('touchstart', 320); touch('touchmove', 245); touch('touchend', 245); tick();
    // Re-touch the opening spring, then lift before horizontal intent is claimed.
    touch('touchstart', 240); touch('touchend', 240); settle();
    assert.equal(x(), -82);
    for (let i = 0; i < 5; i++) {
      touch('touchstart', 240); touch('touchmove', 310); touch('touchend', 310); tick();
      touch('touchstart', 290); touch('touchcancel', 290); settle();
      assert.equal(x(), 0); assert.equal(action.inert, true);
      touch('touchstart', 320); touch('touchmove', 245); touch('touchend', 245); settle();
      assert.equal(x(), -82); assert.equal(action.inert, false);
    }
    assert.equal(calls, 0);
  } finally { dispose(); Object.assign(globalThis, globals); }
});
