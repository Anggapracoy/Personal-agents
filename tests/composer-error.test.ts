import test from 'node:test';
import assert from 'node:assert/strict';
import { composerError } from '../app/composer-error';
import { responseError } from '../app/native-bridge';
test('raw send errors cannot fill Home or native composer with diagnostics', () => {
  for (const value of ['[{"code":"invalid_value","path":["iconKind"]}]', 'Error: database failed\n at internal/file.ts:20', '<html>Bad gateway</html>', 'x'.repeat(10000)]) assert.equal(composerError(value), 'Couldn’t send. Try again.');
  assert.equal(composerError(null), '');
  assert.equal(composerError('Attach up to 6 files, 3 MB total.'), 'Choose up to 6 files, 3 MB total.');
  assert.equal(composerError('Failed to fetch'), 'Check your connection and try again.');
  assert.equal(composerError('Authentication required.'), 'Sign in again to continue.');
  assert.equal(composerError('Too many requests. Please try again shortly.'), 'You’ve hit the limit for now. Try again in a few minutes.');
  assert.equal(composerError('You’ve hit the limit for now. Try again in 12 minutes.'), 'You’ve hit the limit for now. Try again in 12 minutes.');
});

test('rate-limited responses say how long to wait', async () => {
  const limited = (retryAfter: string) => new Response(JSON.stringify({ error: 'Too many requests. Please try again shortly.' }), { status: 429, headers: { 'retry-after': retryAfter } });
  assert.equal(await responseError(limited('20'), 'fallback'), 'You’ve hit the limit for now. Try again in a minute.');
  assert.equal(await responseError(limited('700'), 'fallback'), 'You’ve hit the limit for now. Try again in 12 minutes.');
  assert.equal(await responseError(limited('3500'), 'fallback'), 'You’ve hit the limit for now. Try again in about an hour.');
  assert.equal(await responseError(new Response(null, { status: 429 }), 'fallback'), 'You’ve hit the limit for now. Try again in a minute.');
  assert.equal(await responseError(new Response(JSON.stringify({ error: 'Nope' }), { status: 400 }), 'fallback'), 'Nope');
});
