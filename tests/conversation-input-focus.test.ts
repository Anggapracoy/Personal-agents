import assert from 'node:assert/strict';
import test from 'node:test';
import { attachConversationInputFocus } from '../app/conversation-input-focus';

test('native card focus avoids page reveal, keeps question visible, and preserves caret taps', () => {
  const originals = ['HTMLInputElement', 'HTMLTextAreaElement', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const listeners = new Map<string, (event: unknown) => void>();
  const frames = new Map<number, () => void>();
  let frameId = 0;
  let resizes = () => {};
  let focuses = 0;
  let blurred = 0;
  let prevented = 0;
  const doc = { activeElement: null as unknown, defaultView: null as unknown };
  const win = { __decisionFeedNativeShell: true, innerHeight: 874,
    visualViewport: { height: 874, addEventListener: () => {}, removeEventListener: () => {} },
    requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: () => ({ paddingBottom: '72px' }),
  };
  doc.defaultView = win;
  const page = { ownerDocument: doc, scrollTop: 1116,
    contains: () => true,
    getBoundingClientRect: () => ({ top: 0, bottom: 471 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 113 }) }),
    addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  class Input {
    type = 'text';
    disabled = false;
    readOnly = false;
    style = { opacity: '0.8' };
    closest(selector: string) {
      if (selector === '.wd-card') return {};
      if (selector === 'fieldset') return { getBoundingClientRect: () => ({ top: 73, bottom: 167, height: 94 }) };
      return { getBoundingClientRect: () => this.getBoundingClientRect() };
    }
    getBoundingClientRect() { return { top: 123, bottom: 167, height: 44 }; }
    blur() { blurred++; doc.activeElement = null; }
    focus(options: unknown) {
      assert.deepEqual(options, { preventScroll: true });
      assert.equal(this.style.opacity, '0', 'WebKit must not get a visible reveal target');
      focuses++; doc.activeElement = this;
    }
  }
  Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: Input });
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback: () => void) { resizes = callback; }
    observe() {}
    disconnect() {}
  } });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  try {
    const input = new Input();
    doc.activeElement = input; // autoFocus without a keyboard
    const dispose = attachConversationInputFocus(page as unknown as HTMLElement);
    const tap = () => listeners.get('pointerdown')?.({ target: input, button: 0, preventDefault: () => prevented++ });
    tap();
    assert.equal(prevented, 1);
    assert.equal(blurred, 1);
    assert.equal(focuses, 1);
    flush();
    assert.equal(input.style.opacity, '0.8');
    win.visualViewport.height = 471;
    resizes(); flush();
    assert.equal(page.scrollTop, 1068, 'The question legend, not just its input, must clear the header');
    tap();
    assert.equal(prevented, 1, 'A second tap must preserve native caret selection');
    assert.equal(focuses, 1);
    doc.activeElement = null;
    input.type = 'checkbox';
    tap();
    assert.equal(prevented, 1, 'Non-text controls must keep their normal tap behavior');
    dispose();
    assert.equal(listeners.size, 0);
    assert.equal(frames.size, 0);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
