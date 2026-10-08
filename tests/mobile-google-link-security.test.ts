import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'next-auth/jwt';
import { createMobileGoogleConnectionAuthorizationURL, createMobileGoogleConnectionCompletion, readMobileGoogleConnectionCompletion } from '../lib/auth/mobile-google-connection-oauth';

process.env.AUTH_SECRET = 'google-link-regression-test-secret';
process.env.AUTH_GOOGLE_ID = 'test-client';
process.env.AUTH_GOOGLE_SECRET = 'test-client-secret';
const requestUrl = 'https://dash.example/api/connections/google/complete';
async function fixture() {
  const url = await createMobileGoogleConnectionAuthorizationURL({ requestUrl, ownerEmail: 'initiator@example.invalid', runId: 'run-1' });
  const state = url.searchParams.get('state')!;
  const completion = await createMobileGoogleConnectionCompletion(state, 'single-use-google-code');
  return { state, completion };
}

test('forwarded native Google authorization cannot complete under the consenting recipient account', async () => {
  const { completion } = await fixture();
  await assert.rejects(readMobileGoogleConnectionCompletion({ completion, ownerEmail: 'victim@example.invalid', runId: 'run-1', requestUrl }), /does not belong/);
});

test('initiator can complete only the matching account, operation and origin', async () => {
  const { completion } = await fixture();
  const valid = { completion, ownerEmail: 'INITIATOR@example.invalid', runId: 'run-1', requestUrl };
  assert.equal((await readMobileGoogleConnectionCompletion(valid)).code, 'single-use-google-code');
  await assert.rejects(readMobileGoogleConnectionCompletion({ ...valid, runId: 'other-run' }));
  await assert.rejects(readMobileGoogleConnectionCompletion({ ...valid, requestUrl: 'https://other.example/complete' }));
  await assert.rejects(readMobileGoogleConnectionCompletion({ ...valid, completion: completion.slice(0, -10) + 'tampered' }));
});

test('authorization state alone cannot act as a completion; expired results are rejected', async () => {
  const { state } = await fixture();
  const input = { ownerEmail: 'initiator@example.invalid', runId: 'run-1', requestUrl };
  await assert.rejects(readMobileGoogleConnectionCompletion({ ...input, completion: state }));
  const expired = await encode({ secret: process.env.AUTH_SECRET!, salt: 'wdyt.mobile.google.connection-completion', maxAge: -60,
    token: { kind: 'mobile-google-connection-completion', state, code: 'code' } });
  await assert.rejects(readMobileGoogleConnectionCompletion({ ...input, completion: expired }));
});

test('real unauthenticated callback returns a completion without exchanging or storing Google credentials', async () => {
  // Run without react-server: importing the real Next/Auth route needs React's client exports.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { GET } from './app/api/connections/google/callback/route.ts';
    import { createMobileGoogleConnectionAuthorizationURL, readMobileGoogleConnectionCompletion } from './lib/auth/mobile-google-connection-oauth.ts';
    delete process.env.DATABASE_URL;
    globalThis.fetch = async () => { throw new Error('Callback must not contact Google'); };
    const start = await createMobileGoogleConnectionAuthorizationURL({ requestUrl: 'https://dash.example/start', ownerEmail: 'attacker@example.invalid', runId: 'run-1' });
    const callback = new URL('https://dash.example/api/connections/google/callback');
    callback.searchParams.set('state', start.searchParams.get('state'));
    callback.searchParams.set('code', 'victim-consent-code');
    const response = await GET(new Request(callback));
    assert.equal(response.status, 302);
    const result = new URL(response.headers.get('location'));
    assert.equal(result.searchParams.has('error'), false);
    const completion = result.searchParams.get('completion');
    assert.ok(completion);
    await assert.rejects(readMobileGoogleConnectionCompletion({ completion, ownerEmail: 'victim@example.invalid', runId: 'run-1', requestUrl: callback.href }));
    callback.searchParams.delete('code');
    const cancelled = new URL((await GET(new Request(callback))).headers.get('location'));
    assert.equal(cancelled.searchParams.has('completion'), false);
    assert.equal(cancelled.searchParams.get('error'), 'invalid_response');
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('mobile reconnect uses its own callback and remains bound to the initiating app origin', async () => {
  const requestUrl = 'https://dash.example.invalid/api/connections/google/complete';
  const authorization = await createMobileGoogleConnectionAuthorizationURL({ requestUrl, ownerEmail: 'initiator@example.invalid', runId: 'run-1' });
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://dash.example.invalid/api/connections/google/callback');
  const completion = await createMobileGoogleConnectionCompletion(authorization.searchParams.get('state')!, 'code');
  const input = { completion, ownerEmail: 'initiator@example.invalid', runId: 'run-1', requestUrl };
  assert.equal((await readMobileGoogleConnectionCompletion(input)).redirectUri, 'https://dash.example.invalid/api/connections/google/callback');
  await assert.rejects(readMobileGoogleConnectionCompletion({ ...input, requestUrl: 'https://other.example/complete' }));
  await assert.rejects(readMobileGoogleConnectionCompletion({ ...input, ownerEmail: 'other@example.invalid' }));
});

test('legacy state without an explicit app origin remains bound to its callback origin', async () => {
  const requestUrl = 'https://dash.example.invalid/api/connections/google/complete';
  const state = 'wdyt_connection.' + await encode({ secret: process.env.AUTH_SECRET!, salt: 'wdyt.mobile.google.connection-oauth-state', maxAge: 600,
    token: { kind: 'mobile-google-connection', ownerEmail: 'initiator@example.invalid', runId: 'run-1', verifier: 'a'.repeat(64), redirectUri: 'https://dash.example.invalid/api/connections/google/callback' } });
  const completion = await createMobileGoogleConnectionCompletion(state, 'legacy-code');
  assert.equal((await readMobileGoogleConnectionCompletion({ completion, ownerEmail: 'initiator@example.invalid', runId: 'run-1', requestUrl })).code, 'legacy-code');
});

test('mobile sign-in preserves the origin for each installation, local and preview', async () => {
  const { createMobileGoogleAuthorizationURL } = await import('../lib/auth/mobile-google-oauth');
  for (const [origin, expected] of [
    ['https://native.example.invalid', 'https://native.example.invalid'],
    ['https://dash.example.invalid', 'https://dash.example.invalid'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://preview.example', 'https://preview.example'],
  ]) {
    const result = await createMobileGoogleAuthorizationURL(origin + '/api/mobile/auth/start?handoffChallenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(result.searchParams.get('redirect_uri'), expected + '/api/auth/callback/google');
  }
});
