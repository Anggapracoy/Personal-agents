import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizationUrl, buildCalendarEvent, createCodeChallenge, createCodeVerifier, createOAuthState, findConflicts, refreshAccessToken, suggestSlots } from '../src/google-calendar.js';

test('builds Google OAuth URL with PKCE and calendar scope', () => {
  const url = new URL(buildAuthorizationUrl({ clientId: 'client', redirectUri: 'https://anakbuah.example.com/oauth/google/callback', state: 'state', codeChallenge: 'challenge' }));
  assert.equal(url.hostname, 'accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
});

test('OAuth nonces have sufficient entropy', () => {
  assert.ok(createOAuthState().length >= 40);
  assert.ok(createCodeVerifier().length >= 60);
});

test('derives PKCE challenge from verifier', () => {
  assert.equal(createCodeChallenge('verifier'), 'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ');
});

test('finds overlapping timed and all-day events', () => {
  const events = [{ id: 'timed', start: { dateTime: '2026-10-09T09:30:00Z' }, end: { dateTime: '2026-10-09T10:30:00Z' } }, { id: 'day', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } }];
  assert.deepEqual(findConflicts(events, '2026-10-09T10:00:00Z', '2026-10-09T11:00:00Z').map(x => x.id), ['timed']);
  assert.deepEqual(findConflicts(events, '2026-10-10T12:00:00Z', '2026-10-10T13:00:00Z').map(x => x.id), ['day']);
});

test('builds calendar event and suggests free slots', () => {
  const event = buildCalendarEvent({ summary: 'Meeting Anakbuah', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', attendees: ['a@example.com'] });
  assert.equal(event.summary, 'Meeting Anakbuah');
  assert.equal(event.attendees[0].email, 'a@example.com');
  const busy = [{ start: { dateTime: '2026-10-09T10:00:00Z' }, end: { dateTime: '2026-10-09T11:00:00Z' } }];
  assert.deepEqual(suggestSlots(busy, '2026-10-09T10:00:00Z', { count: 1 })[0].start, new Date('2026-10-09T11:00:00Z'));
});

test('refreshes an expired Google access token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => { assert.match(options.body.toString(), /grant_type=refresh_token/); return new Response(JSON.stringify({ access_token: 'new-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { assert.equal((await refreshAccessToken({ refreshToken: 'refresh', clientId: 'id', clientSecret: 'secret' })).access_token, 'new-token'); } finally { globalThis.fetch = originalFetch; }
});
