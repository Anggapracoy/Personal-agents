import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function check(source: string, settings: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', ...settings };
  const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', source], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('removed administrative and tracking entrypoints cannot be registered as routes', () => {
  for (const path of ['app/api/admin', 'app/admin-erjkfh23lrjghrjk959584', 'app/api/analytics', 'app/analytics-test', 'app/api/mobile/client-events', 'app/api/settings/agent-model', 'lib/admin-data.ts', 'lib/admin-auth.ts', 'app/api/billing', 'app/billing', 'lib/billing', 'app/billing-usage.tsx']) {
    assert.equal(existsSync(path), false, path);
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.dependencies.datafast, undefined);
  assert.equal(pkg.dependencies.stripe, undefined);
  assert.equal(pkg.dependencies['@vercel/analytics'], undefined);
});

test('feature defaults need no privileged identity and billing is absent', () => {
  check(`
    import assert from 'node:assert/strict';
    import { callingEnabled, callingPolicySchema, defaultCallingPolicy } from './lib/calling-policy.ts';
    assert.equal(callingEnabled(defaultCallingPolicy, 'owner@example.invalid'), true);
    assert.equal(callingPolicySchema.safeParse({mode:'admin', users:[], revision:0}).success, false);
    assert.equal(callingEnabled({...defaultCallingPolicy, mode:'selected', users:[{email:'owner@example.invalid',enabled:true}]}, 'owner@example.invalid'), true);
    assert.equal(callingEnabled({...defaultCallingPolicy, mode:'selected', users:[{email:'owner@example.invalid',enabled:true}]}, 'other@example.invalid'), false);
  `, { WDYT_ADMIN_EMAIL: 'owner@example.invalid' });
});

test('explicit installation values control public links', () => {
  check(`
    import assert from 'node:assert/strict';
    import { APP_ORIGIN, SUPPORT_EMAIL } from './lib/deployment.ts';
    import { googleOAuthOrigin } from './lib/auth/google-oauth-origin.ts';
    assert.equal(APP_ORIGIN, 'https://installation.example');
    assert.equal(SUPPORT_EMAIL, 'support@installation.example');
    assert.equal(googleOAuthOrigin('https://preview.example/start'), 'https://preview.example');
  `, { NEXT_PUBLIC_APP_ORIGIN: 'https://installation.example/', NEXT_PUBLIC_SUPPORT_EMAIL: 'support@installation.example' });
});

test('telemetry cleanup removes old tracking data without deleting conversations or granting access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE product_analytics_events(id int); CREATE TABLE product_analytics_subjects(id int); CREATE TABLE agent_run_diagnostics(id int);
      CREATE TABLE conversations(id int, body text); INSERT INTO conversations VALUES (1, 'keep this conversation');
      CREATE TABLE app_feature_flags(key text, value jsonb); INSERT INTO app_feature_flags VALUES ('voice_calling','{"mode":"admin","users":[]}');`);
    const migration = readFileSync('db/migrations/0037_remove_telemetry.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    const tables = await db.query<{name: string|null}>("SELECT to_regclass('product_analytics_events')::text AS name UNION ALL SELECT to_regclass('product_analytics_subjects')::text UNION ALL SELECT to_regclass('agent_run_diagnostics')::text");
    assert.ok(tables.rows.every(row => row.name === null));
    assert.equal((await db.query<{body:string}>('SELECT body FROM conversations')).rows[0].body, 'keep this conversation');
    assert.deepEqual((await db.query<{value:unknown}>('SELECT value FROM app_feature_flags')).rows[0].value, {mode:'selected', users:[]});
  } finally { await db.close(); }
});

test('fresh migrations enable calling and proactive work without replacing saved disables', async () => {
  const db = new PGlite();
  try {
    const migrations = ['0018_feature_flags.sql', '0019_morning_ideas.sql'].map(name => readFileSync(`db/migrations/${name}`, 'utf8'));
    for (const migration of migrations) await db.exec(migration);
    const initial = await db.query<{key:string; value:{mode:string}}>('SELECT key, value FROM app_feature_flags ORDER BY key');
    assert.deepEqual(initial.rows.map(row => [row.key, row.value.mode]), [['daily_proactive', 'everyone'], ['voice_calling', 'everyone']]);
    await db.exec(`UPDATE app_feature_flags SET value='{"mode":"none","users":[]}' WHERE key='daily_proactive';
      UPDATE app_feature_flags SET value='{"mode":"everyone","users":[{"email":"excluded@example.invalid","enabled":false}]}' WHERE key='voice_calling';`);
    for (const migration of migrations) await db.exec(migration);
    const saved = await db.query<{key:string; value:{mode:string;users:unknown[]}}>('SELECT key, value FROM app_feature_flags ORDER BY key');
    assert.equal(saved.rows[0].value.mode, 'none');
    assert.deepEqual(saved.rows[1].value.users, [{email:'excluded@example.invalid',enabled:false}]);
  } finally { await db.close(); }
});
