import assert from 'node:assert/strict';
import test from 'node:test';
import { attachConversationViewport, conversationIsPinned } from '../app/conversation-viewport';

test('keyboard and composer resizing follows the bottom but preserves a reader in history', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  let resize = () => {};
  let scroll = () => {};
  let disconnected = false;
  const observed: unknown[] = [];
  const thread = {};
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback: () => void) { resize = callback; }
    observe(target: unknown) { observed.push(target); }
    disconnect() { disconnected = true; }
  } });
  try {
    const page = { clientHeight: 700, scrollHeight: 1400, scrollTop: 700,
      addEventListener: (_: string, callback: () => void) => { scroll = callback; },
      removeEventListener: () => {},
      querySelector: () => thread,
    };
    const dispose = attachConversationViewport(page as unknown as HTMLElement);
    assert.ok(observed.includes(thread), "Delayed link/image layout is observed");
    assert.equal(conversationIsPinned(page as unknown as HTMLElement), true);
    page.scrollHeight += 150; // A link preview image arrives after the message.
    resize();
    assert.equal(page.scrollTop, 850);
    page.scrollHeight = 1400;
    page.clientHeight = 400;
    scroll(); // WebKit can dispatch this before the resize callback.
    resize();
    assert.equal(page.scrollTop, 1000);
    page.scrollHeight = 1460; // A multiline composer adds bottom space.
    resize();
    assert.equal(page.scrollTop, 1060);
    page.scrollTop = 300;
    scroll();
    assert.equal(conversationIsPinned(page as unknown as HTMLElement), false);
    page.scrollHeight += 100;
    assert.equal(conversationIsPinned(page as unknown as HTMLElement), false, "An incoming message does not steal the reader anchor");
    page.clientHeight = 350;
    resize();
    assert.equal(page.scrollTop, 300);
    dispose();
    assert.equal(disconnected, true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'ResizeObserver', original);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});
