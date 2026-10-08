import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { consumeApiQuota } from '../lib/api-quota';
import { isSessionRevoked, revokeSession, revokeUserSessions } from '../lib/auth/session-revocation';

const url = process.env.SECURITY_TEST_DATABASE_URL;
after(async () => {
  if (!url) return;
  const { securityDatabase } = await import('../lib/security-store');
  await securityDatabase()?.end();
  const { getDb } = await import('../db');
  await (getDb() as unknown as { $client: ReturnType<typeof postgres> }).$client.end();
});
test('PostgreSQL enforces quotas across connections and durably revokes sessions', { skip: !url }, async () => {
  if (!url || new URL(url).hostname !== '127.0.0.1') throw new Error('Dedicated local database required');
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const schema = `security_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin.unsafe(`create schema ${schema}`);
  const db = postgres(url, { max: 8, connection: { search_path: schema } });
  const other = postgres(url, { max: 8, connection: { search_path: schema } });
  try {
    await db.unsafe(await readFile(new URL('../db/migrations/0021_security_boundaries.sql', import.meta.url), 'utf8'));
    const results = await Promise.all(Array.from({ length: 32 }, (_, i) => consumeApiQuota('person@example.invalid', 'run', i % 2 ? db : other, 0)));
    assert.equal(results.filter(result => result.allowed).length, 4);
    assert.equal((await consumeApiQuota('other@example.invalid', 'run', db, 0)).allowed, true);
    assert.equal((await consumeApiQuota('person@example.invalid', 'run', db, 60_000)).allowed, true);
    const token = { email: 'person@example.invalid', sessionId: 'original', sessionIssuedAt: Date.now() - 1000 };
    const second = { ...token, sessionId: 'other-device' };
    await revokeSession(token, db);
    assert.equal(await isSessionRevoked(token, other), true);
    assert.equal(await isSessionRevoked(second, other), false);
    await revokeUserSessions(token.email, db);
    assert.equal(await isSessionRevoked(second, other), true);
    assert.equal(await isSessionRevoked({ ...second, sessionIssuedAt: Date.now() + 1000 }, other), false);
  } finally {
    await db.end(); await other.end(); await admin.unsafe(`drop schema ${schema} cascade`); await admin.end();
  }
});

test('account deletion clears persistent approvals and revokes old sessions without affecting another user', { skip: !url }, async () => {
  if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/dash_security_test') throw new Error('Dedicated migrated dash_security_test database required');
  process.env.DATABASE_URL = url;
  delete process.env.E2B_API_KEY;
  const db = postgres(url, { max: 1 });
  const suffix = crypto.randomUUID();
  const owner = `delete_${suffix}@example.invalid`;
  // '_' in an email is a SQL LIKE wildcard; this account must be untouched.
  const other = `deleteX${suffix}@example.invalid`;
  const token = { email: owner, sessionId: 'delete-session', sessionIssuedAt: Date.now() - 1000 };
  try {
    await db`insert into agent_approval_preferences (owner_email, category, always_approve) values (${owner}, 'email_send', true), (${owner}, 'purchase', true), (${other}, 'purchase', true)`;
    await db`insert into discovery_scan_states (user_key) values (${owner}), (${`${owner}:connection`}), (${`${other}:connection`})`;
    const { deleteUserData } = await import('../lib/user-data');
    await deleteUserData(owner, { deleteAccount: true });
    assert.equal((await db`select * from agent_approval_preferences where owner_email=${owner}`).length, 0);
    assert.equal((await db`select * from agent_approval_preferences where owner_email=${other}`).length, 1);
    assert.equal((await db`select * from discovery_scan_states where user_key in (${owner}, ${`${owner}:connection`})`).length, 0);
    assert.equal((await db`select * from discovery_scan_states where user_key=${`${other}:connection`}`).length, 1);
    assert.equal(await isSessionRevoked(token, db), true);
  } finally {
    await db`delete from agent_approval_preferences where owner_email in (${owner}, ${other})`;
    await db`delete from discovery_scan_states where user_key in (${owner}, ${`${owner}:connection`}, ${`${other}:connection`})`;
    await db`delete from auth_revocations where key=${`owner:${owner}`}`;
    await db.end();
  }
});

test('real Auth.js sessions reject revoked cookies and signout revokes the issued session', { skip: !url }, async () => {
  if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/dash_security_test') throw new Error('Dedicated local database required');
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = 'isolated-auth-test-secret-not-used-by-the-app';
  const { encode } = await import('next-auth/jwt');
  const { NextRequest } = await import('next/server');
  const { handlers } = await import('../auth');
  const token = { email: `auth-${crypto.randomUUID()}@example.invalid`, sub: 'test', authProvider: 'apple', sessionId: crypto.randomUUID(), sessionIssuedAt: Date.now() - 1000 };
  const jwt = await encode({ token, secret: process.env.AUTH_SECRET, salt: 'decision-feed.session-token' });
  const cookie = `decision-feed.session-token=${jwt}`;
  const session = () => handlers.GET(new NextRequest('http://localhost/api/auth/session', { headers: { cookie } }));
  assert.equal((await (await session()).json()).user.email, token.email);
  const csrf = await handlers.GET(new NextRequest('http://localhost/api/auth/csrf'));
  const csrfToken = (await csrf.json()).csrfToken;
  const csrfCookies = csrf.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  await handlers.POST(new NextRequest('http://localhost/api/auth/signout', { method: 'POST', headers: { cookie: `${cookie}; ${csrfCookies}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, callbackUrl: 'http://localhost/' }) }));
  assert.equal(await (await session()).json(), null);
});

test('provider cleanup failure never rolls back local deletion and a durable retry removes its lock', { skip: !url }, async () => {
  process.env.DATABASE_URL = url;
  const previous = { AUTH_SECRET: process.env.AUTH_SECRET, BROWSERLESS_API_TOKEN: process.env.BROWSERLESS_API_TOKEN, E2B_API_KEY: process.env.E2B_API_KEY };
  process.env.AUTH_SECRET = 'isolated-deletion-outbox-test-secret';
  process.env.BROWSERLESS_API_TOKEN = 'synthetic-never-sent';
  process.env.E2B_API_KEY = 'synthetic-never-sent';
  const db = postgres(url!, { max: 1 });
  const owner = `outbox-${crypto.randomUUID()}@example.invalid`;
  const { deleteUserData } = await import('../lib/user-data');
  const { finishAccountDeletion } = await import('../lib/account-deletion-cleanup');
  const { isAccountDeletionPending } = await import('../lib/auth/session-revocation');
  const noProviders = { google: async () => {}, composio: async () => {}, browser: async () => {}, localAccount: async () => {} };
  try {
    await db`insert into workspace_states(owner_email,state_json,preferences_json) values (${owner},'{}'::jsonb,'{}'::jsonb)`;
    await db`insert into proactive_moments(owner_email,kind,place_label,occurred_at) values (${owner},'arrived','Fixture home',now())`;
    await db`insert into proactive_deliveries(owner_email,local_date,kind) values (${owner},current_date,'now')`;
    await db`insert into waitlist_entries(email) values (${owner})`;
    await db`insert into users(email,name,google_access_token,location_lat,preferences_json) values (${owner},'Fixture','obsolete-fixture-token',43,'{"old":"data"}'::jsonb)`;
    const result = await deleteUserData(owner, { deleteAccount: false }, email => finishAccountDeletion(email, { ...noProviders, browser: async () => { throw new Error('provider offline'); } }));
    assert.equal(result.cleanupPending, true);
    for (const table of ['workspace_states','proactive_moments','proactive_deliveries']) assert.equal((await db`select 1 from ${db(table)} where owner_email=${owner}`).length, 0);
    assert.equal((await db`select 1 from waitlist_entries where email=${owner}`).length, 0);
    const [legacy] = await db`select google_access_token,location_lat,preferences_json from users where email=${owner}`;
    assert.equal(legacy.google_access_token, null); assert.equal(legacy.location_lat, null); assert.deepEqual(legacy.preferences_json, {});
    assert.equal(await isAccountDeletionPending(owner), true);
    const [job] = await db`select encrypted_payload,attempts from account_deletion_jobs where owner_email=${owner}`;
    assert.equal(job.attempts, 1); assert.ok(!job.encrypted_payload.includes('browser'));
    assert.equal(await finishAccountDeletion(owner, noProviders), true);
    assert.equal(await isAccountDeletionPending(owner), false);
    assert.equal((await db`select 1 from account_deletion_jobs where owner_email=${owner}`).length, 0);
  } finally {
    await db`delete from users where email=${owner}`;
    await db`delete from account_deletion_jobs where owner_email=${owner}`;
    await db`delete from auth_revocations where key=${`deleting:${owner}`}`;
    await db.end();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('a stolen handoff code cannot be redeemed without its device verifier or consume the real attempt', { skip: !url }, async () => {
  process.env.DATABASE_URL = url;
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'isolated-device-binding-test-secret';
  const { createMobileAuthHandoff, consumeMobileAuthHandoff, handoffChallenge } = await import('../lib/auth/mobile-handoff');
  try {
    const verifier = 'a'.repeat(43);
    const code = await createMobileAuthHandoff('synthetic-session', handoffChallenge(verifier)!);
    assert.equal(await consumeMobileAuthHandoff(code, 'b'.repeat(43)), null);
    assert.equal(await consumeMobileAuthHandoff(code), null);
    assert.equal(await consumeMobileAuthHandoff(code, verifier), 'synthetic-session');
    assert.equal(await consumeMobileAuthHandoff(code, verifier), null);
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
