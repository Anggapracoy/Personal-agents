import assert from 'node:assert/strict';
import test from 'node:test';
import { browserSessionExpired, browserUnavailablePage, pendingTakeover, reopenTakeover } from '../lib/harness/browser/takeover-recovery';
import type { AgentAction } from '../lib/harness/types';

test('only a lost or ending session permits explicit recovery', () => {
  assert.equal(browserSessionExpired(new Error('Browser session is not running. Saved logins may be restored.')), true);
  assert.equal(browserSessionExpired(new Error('Browser session is ending; reopen the website before takeover')), true);
  assert.equal(browserSessionExpired(new Error('HTTP 403')), false);
  assert.equal(browserSessionExpired(new Error('Timeout waiting for response')), false);
});
test('recovery requires a pending takeover and uses a POST without interpolating error details', () => {
  const action = { toolName: 'browser_request_takeover', status: 'proposed' } as AgentAction;
  assert.equal(pendingTakeover([action]), action);
  assert.equal(pendingTakeover([{ ...action, status: 'executed' }]), undefined);
  const html = browserUnavailablePage('run-id', true, true);
  assert.match(html, /method="post"/);
  assert.match(html, /Reopen page/);
  assert.match(html, /enter details again/);
  assert.doesNotMatch(browserUnavailablePage('run-id', true, false), /<form/);
  assert.doesNotMatch(browserUnavailablePage('run-id', false, true), /<form/);
});

test('recovery reconnects a live page, replaces only an expired page, and never retries unrelated failures', async () => {
  for (const state of ['live', 'expired', 'network']) {
    const calls: string[] = [];
    const browser = {
      async takeoverUrl() {
        calls.push('takeover');
        if (calls.length === 1 && state !== 'live') throw new Error(state === 'expired' ? 'Browser session is not running.' : 'HTTP 403');
        return 'https://production-sfo.browserless.io/live';
      },
      async open(user: string, url: string) { calls.push('open'); assert.equal(user, 'owner'); assert.equal(url, 'https://shop.example/checkout'); },
    };
    const result = reopenTakeover(browser, 'owner', 'https://shop.example/checkout');
    if (state === 'network') await assert.rejects(result, /403/);
    else assert.match(await result, /https:/);
    assert.deepEqual(calls, state === 'expired' ? ['takeover', 'open', 'takeover'] : ['takeover']);
  }
});
