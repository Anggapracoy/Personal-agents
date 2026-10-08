import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationMotion } from '../app/navigation-motion';

// Minimal DOM fixture lets us inspect intermediate frames, not just settled pages.
class Surface {
  classes: Set<string>;
  style = { transform: '', opacity: '', zIndex: '' };
  dataset: Record<string, string> = {};
  inert = false;
  scrollTop = 0;
  scrollLeft = 0;
  children: Surface[] = [];
  remove = () => {};
  constructor(classes: string[]) { this.classes = new Set(classes); }
  classList = { add: (name: string) => this.classes.add(name), contains: (name: string) => this.classes.has(name) };
  setAttribute() {}
  removeAttribute() {}
  querySelectorAll(selector: string) { return selector === '*' ? this.children : []; }
  cloneNode(): Surface {
    const copy = new Surface([...this.classes]);
    copy.style = { ...this.style }; copy.dataset = { ...this.dataset };
    copy.children = this.children.map(child => child.cloneNode());
    return copy;
  }
}
const x = (node: Surface) => Number(node.style.transform.match(/translate3d\(([-\d.]+)px/)?.[1] ?? 0);
function fixture(reduced = false) {
  let now = 0, nextId = 0;
  const frames = new Map<number, (time: number) => void>();
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  install('window', { matchMedia: () => ({ matches: reduced }) });
  install('getComputedStyle', (node: Surface) => node.style);
  install('DOMMatrixReadOnly', class { m41: number; constructor(transform: string) { this.m41 = Number(transform.match(/translate3d\(([-\d.]+)px/)?.[1] ?? 0); } });
  install('requestAnimationFrame', (fn: (time: number) => void) => { frames.set(++nextId, fn); return nextId; });
  install('cancelAnimationFrame', (id: number) => frames.delete(id));
  const home = new Surface(['wd-home-layer', 'is-current']);
  home.children = [new Surface(['wd-home'])]; home.children[0].scrollTop = 240;
  const nodes = [home];
  const main = { append(node: Surface) { nodes.push(node); node.remove = () => { nodes.splice(nodes.indexOf(node), 1); }; } };
  const root = { clientWidth: 390, querySelector(selector: string) {
    if (selector === '.wd-main') return main;
    const name = selector.includes('wd-front-layer') ? 'wd-front-layer' : 'wd-home-layer';
    return nodes.find(node => node.classes.has(name) && !node.classes.has('wd-navigation-ghost')) ?? null;
  } };
  const published: Array<{phase: string; incoming?: number; outgoing?: number; opacity?: number}> = [];
  const motion = createNavigationMotion(() => root as unknown as HTMLElement, frame => published.push(frame));
  const advance = () => { now += 16.67; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(now)); };
  const settle = () => { for (let i = 0; frames.size && i < 200; i++) advance(); assert.equal(frames.size, 0); };
  return { motion, home, nodes, published, advance, settle, cleanup() { motion.dispose(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } } };
}

test('push and pop publish the same intermediate positions painted on both page surfaces', () => {
  const h = fixture();
  try {
    const from = h.motion.capture('task', 'home');
    const ghost = h.nodes.find(node => node.classes.has('wd-navigation-ghost'))!;
    assert.ok(ghost.classes.has('wd-home-layer'));
    assert.ok(ghost.classes.has('is-current'));
    assert.equal(ghost.children[0].scrollTop, 240);
    const task = new Surface(['wd-front-layer']); h.nodes.unshift(task);
    h.motion.navigate('push', from);
    h.advance();
    let frame = h.published.at(-1)!;
    assert.equal(frame.incoming, x(task)); assert.equal(frame.outgoing, x(ghost));
    assert.ok(x(task) > 0 && x(task) < 390);
    h.settle();
    h.motion.drag(.4);
    assert.equal(x(task), 156);
    assert.equal(x(h.home), -.28 * (390 - 156));
    assert.equal(h.home.children[0].scrollTop, 240);
    assert.ok(!h.nodes.some(node => node.classes.has('wd-navigation-ghost')), 'slow back drag reveals the retained live Home, not a stale unscrolled clone');
    const homeBeforeRelease = x(h.home);
    const popFrom = h.motion.capture('home', 'task');
    assert.equal(x(h.home), homeBeforeRelease, 'Home must not jump between swipe capture and the React commit');
    assert.equal(x(task), 156, 'the live chat stays at the release position until React replaces it');
    assert.equal(popFrom, 156);
    h.nodes.splice(h.nodes.indexOf(task), 1);
    const departing = h.nodes.find(node => node.classes.has('wd-navigation-ghost'))!;
    h.motion.navigate('pop', popFrom); h.advance();
    frame = h.published.at(-1)!;
    assert.equal(frame.incoming, x(h.home)); assert.equal(frame.outgoing, x(departing));
    h.settle();
    assert.equal(h.published.at(-1)?.phase, 'end');
    assert.equal(h.home.children[0].scrollTop, 240);
    assert.ok(!h.nodes.some(node => node.classes.has('wd-navigation-ghost')));
  } finally { h.cleanup(); }
});

test('cancelled swipe returns both surfaces and emits completion; reduced motion shares opacity', () => {
  for (const reduced of [false, true]) {
    const h = fixture(reduced);
    try {
      h.motion.capture('task', 'home');
      const task = new Surface(['wd-front-layer']); h.nodes.unshift(task);
      h.motion.navigate('push', 0);
      if (reduced) { h.advance(); assert.ok(h.published.at(-1)!.opacity! > 0); }
      h.settle();
      if (!reduced) {
        h.motion.drag(.2); h.motion.cancel(); h.advance();
        assert.equal(h.published.at(-1)?.incoming, x(task));
        h.settle(); assert.equal(x(task), 0);
        assert.equal(h.published.at(-1)?.phase, 'end');
      }
    } finally { h.cleanup(); }
  }
});

test('left Settings entry, swipe cancellation, and dismissal share mirrored page positions', () => {
  const h = fixture();
  try {
    h.motion.capture('settings', 'home');
    const settings = new Surface(['wd-front-layer']); h.nodes.unshift(settings);
    h.motion.navigate('push', 0, -1);
    assert.equal(x(settings), -390);
    h.advance();
    assert.ok(x(settings) < 0 && x(settings) > -390);
    assert.ok(h.published.at(-1)!.outgoing! > 0);
    h.settle();
    h.motion.drag(.4);
    assert.equal(x(settings), -156);
    assert.equal(x(h.home), .28 * (390 - 156));
    h.motion.cancel(); h.settle(); assert.equal(x(settings), 0);
    h.motion.drag(.4);
    const from = h.motion.capture('home', 'settings');
    h.nodes.splice(h.nodes.indexOf(settings), 1);
    h.motion.navigate('pop', from); h.advance();
    assert.ok(h.published.at(-1)!.outgoing! < -156);
    assert.ok(x(h.home) > 0);
    h.settle(); assert.equal(x(h.home), 0);
  } finally { h.cleanup(); }
});

test('interactive Settings opening follows progress and completes or reverses without a jump', () => {
  for (const commit of [true, false]) {
    const h = fixture();
    try {
      h.motion.capture('settings', 'home');
      const settings = new Surface(['wd-front-layer']); h.nodes.unshift(settings);
      h.motion.navigate('push', 0, -1);
      h.motion.dragPush(.25);
      assert.equal(x(settings), -292.5);
      assert.equal(h.published.at(-1)?.outgoing, 390 * .28 * .25);
      h.advance(); assert.equal(x(settings), -292.5, 'no spring runs while the finger holds the page');
      if (commit) { h.motion.finishPush(); h.settle(); assert.equal(x(settings), 0); }
      else {
        const from = h.motion.capture('home', 'settings');
        assert.equal(from, -292.5);
        h.nodes.splice(h.nodes.indexOf(settings), 1);
        h.motion.navigate('pop', from); h.settle();
        assert.equal(x(h.home), 0);
      }
      assert.equal(h.home.children[0].scrollTop, 240);
    } finally { h.cleanup(); }
  }
});

test('nested Settings pages retain left entry and reveal their parent during return gestures', () => {
  const h = fixture();
  try {
    const screens: Surface[] = [];
    for (const [index, key] of ['settings', 'memory', 'people'].entries()) {
      const from = h.motion.capture(key, index ? ['settings', 'memory'][index - 1] : 'home');
      if (screens.length) h.nodes.splice(h.nodes.indexOf(screens.at(-1)!), 1);
      const page = new Surface(['wd-front-layer']); page.dataset.page = key;
      screens.push(page); h.nodes.unshift(page);
      h.motion.navigate('push', from, -1);
      assert.equal(x(page), -390);
      h.settle();
    }
    const people = screens[2];
    h.motion.drag(.4);
    assert.equal(x(people), -156);
    assert.ok(h.nodes.some(node => node.dataset.page === 'memory' && x(node) > 0));
    h.motion.cancel(); h.settle(); assert.equal(x(people), 0);
    const from = h.motion.capture('memory', 'people');
    h.nodes.splice(h.nodes.indexOf(people), 1);
    h.nodes.unshift(screens[1]);
    h.motion.navigate('pop', from, -1); h.settle();
    h.motion.drag(.4);
    assert.equal(x(screens[1]), -156, 'returning to Memory preserves its own leftward back direction');
    assert.ok(h.nodes.some(node => node.dataset.page === 'settings' && x(node) > 0));
  } finally { h.cleanup(); }
});

test('fast back swipe during the opening spring keeps live Home aligned through release', () => {
  const h = fixture();
  try {
    h.motion.capture('task', 'home');
    const task = new Surface(['wd-front-layer']); h.nodes.unshift(task);
    h.motion.navigate('push', 0);
    for (let i = 0; i < 6; i++) h.advance();
    h.motion.drag(.2);
    const visibleHomeX = h.published.at(-1)!.outgoing!;
    assert.equal(x(h.home), visibleHomeX, 'an interrupted opening must reveal live Home at the same parallax position');
    const from = h.motion.capture('home', 'task');
    assert.equal(x(h.home), visibleHomeX, 'capture must not expose an unshifted Home');
    h.nodes.splice(h.nodes.indexOf(task), 1);
    h.motion.navigate('pop', from);
    assert.equal(x(h.home), visibleHomeX);
    h.settle();
    assert.equal(x(h.home), 0);
    assert.equal(h.home.children[0].scrollTop, 240);
  } finally { h.cleanup(); }
});
