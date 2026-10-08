import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('app billing removal preserves conversations and unrelated feature controls', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE billing_accounts(owner text PRIMARY KEY);
      CREATE TABLE billing_usage(owner text REFERENCES billing_accounts(owner));
      CREATE TABLE billing_webhook_events(id text);
      INSERT INTO billing_accounts VALUES ('owner@example.invalid');
      INSERT INTO billing_usage VALUES ('owner@example.invalid');
      CREATE TABLE agent_runs(id text, request text); INSERT INTO agent_runs VALUES ('run-1','keep my chat');
      CREATE TABLE app_feature_flags(key text, value jsonb);
      INSERT INTO app_feature_flags VALUES ('billing','{"mode":"everyone"}'),('voice_calling','{"mode":"everyone"}');`);
    const migration = readFileSync('db/migrations/0038_remove_app_billing.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    const tables = await db.query<{name:string|null}>(`SELECT to_regclass('billing_accounts')::text AS name UNION ALL SELECT to_regclass('billing_usage')::text UNION ALL SELECT to_regclass('billing_webhook_events')::text`);
    assert.ok(tables.rows.every(row => row.name === null));
    assert.equal((await db.query<{request:string}>('SELECT request FROM agent_runs')).rows[0].request, 'keep my chat');
    assert.deepEqual((await db.query<{key:string}>('SELECT key FROM app_feature_flags')).rows, [{key:'voice_calling'}]);
  } finally { await db.close(); }
});

test('Stripe and application plan enforcement entrypoints are absent', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.dependencies.stripe, undefined);
  for (const path of ['app/api/billing','app/billing','app/billing-usage.tsx','lib/billing']) assert.equal(existsSync(path),false,path);
  for (const path of ['app/api/runs/route.ts','app/api/runs/[id]/message/route.ts','app/api/transcribe/route.ts']) {
    const source = readFileSync(path,'utf8');
    assert.doesNotMatch(source,/planAccessResponse|billingEnabled|getBillingStore/);
    assert.match(source,/enforceApiQuota/, 'abuse-prevention quotas remain independent of paid plans');
  }
});
