import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function gestureHarness(kind = 'task') {
  const source = readFileSync(new URL('../app/workspace.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('    const setSwipe =', source.indexOf('/* Edge back-swipe'));
  const end = source.indexOf('\n  }, [browserSheet', start);
  const body = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  const attrs = new Set();
  const listeners = new Map();
  let backs = 0;
  const root = { clientWidth: 390, style: { setProperty(k,v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }, setAttribute: k => attrs.add(k), removeAttribute: k => attrs.delete(k), hasAttribute: k => attrs.has(k) };
  const cleanup = vm.runInNewContext(`(function(){${body}})()`, {
    motionRef: { current: { drag: p => root.style['--swipe-x'] = `${p*390}px`, cancel: () => delete root.style['--swipe-x'] } }, browserSheet: null, calendarContext: null, confirm: null,
    screenRef: { current: { kind } }, back: () => backs++,
    window: { setTimeout: fn => fn(), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
  });
  return { root, cleanup, get backs() { return backs; }, send(phase, progress, commit = false) { listeners.get('decisionFeed:nativeBackSwipe')({ detail: { phase, progress, commit } }); } };
}

test('child screen follows back swipe and commits navigation', () => {
  const h = gestureHarness();
  h.send('began', 0); h.send('changed', .4);
  assert.equal(h.root.style['--swipe-x'], '156px');
  h.send('ended', .4, true);
  assert.equal(h.backs, 1);
  // Navigation commits immediately; the spring owns the remaining movement.
  h.cleanup();
});
test('cancelled back swipe keeps the current screen', () => {
  const h = gestureHarness();
  h.send('began', 0); h.send('changed', .2); h.send('cancelled', .2);
  assert.equal(h.backs, 0);
  assert.equal(h.root.style['--swipe-x'], undefined);
  h.cleanup();
});
test('Home edge swipe has no navigation effect', () => {
  const h = gestureHarness('home');
  h.send('began', 0); h.send('changed', .8); h.send('ended', .8, true);
  assert.equal(h.backs, 0);
  assert.equal(h.root.style['--swipe-x'], undefined);
  h.cleanup();
});
