import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { claimMorning, dueMorningAccounts, failMorning, previousMorningIdeas, publishMorning } from '../lib/proactive/morning-jobs';
import { isMorningAllowed } from '../lib/proactive/morning-access';

import type { MorningReport } from '../lib/proactive/morning-ideas';

// Explicit opt-in. All relations are TEMP tables on one connection, shadowing
// production names. The transaction always rolls back, including on assertion failure.
test('morning ledger fences stale workers, retries failures, and publishes once without touching other owners', { skip: process.env.MORNING_DB_TEST !== 'true' }, async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const rollback = new Error('rollback-test');
  try {
    await assert.rejects(drizzle(client).transaction(async db => {
      await db.execute(sql.raw(`CREATE TEMP TABLE morning_idea_runs (owner_email text, local_date date, time_zone text, status text DEFAULT 'running', attempts int DEFAULT 1, lease_until timestamptz, started_at timestamptz DEFAULT now(), completed_at timestamptz, report jsonb, error text, PRIMARY KEY(owner_email, local_date)) ON COMMIT DROP`));
      await db.execute(sql.raw(`CREATE TEMP TABLE workspace_states (owner_email text PRIMARY KEY, state_json jsonb, version int DEFAULT 0, updated_at timestamptz DEFAULT now()) ON COMMIT DROP`));
      await db.execute(sql.raw(`CREATE TEMP TABLE user_life_profiles (owner_email text, time_zone text) ON COMMIT DROP`));
      await db.execute(sql.raw(`CREATE TEMP TABLE mobile_user_states (owner_email text, onboarding_completed boolean) ON COMMIT DROP`));
      await db.execute(sql.raw(`CREATE TEMP TABLE app_feature_flags (key text PRIMARY KEY, value jsonb, revision int) ON COMMIT DROP`));
      await db.execute(sql.raw(`CREATE TEMP TABLE proactive_candidates (id uuid DEFAULT gen_random_uuid(), owner_email text, kind text, dedupe_key text, tier text, status text DEFAULT 'pending', decision_id text, title text, body text, reason text, payload jsonb, deliver_after timestamptz, expires_at timestamptz, UNIQUE(owner_email, dedupe_key)) ON COMMIT DROP`));
      await db.execute(sql.raw(`CREATE TEMP TABLE proactive_preferences (owner_email text PRIMARY KEY, quiet_start smallint DEFAULT 22, quiet_end smallint DEFAULT 8, max_buzzes smallint DEFAULT 3, muted_senders jsonb DEFAULT '[]', muted_topics jsonb DEFAULT '[]', category_feedback jsonb DEFAULT '{}', last_wake_at timestamptz) ON COMMIT DROP`));
      await db.execute(sql.raw(`CREATE TEMP TABLE push_notification_jobs (id uuid DEFAULT gen_random_uuid(),owner_email text,decision_id text,title text,subtitle text,body text,status text,UNIQUE(owner_email,decision_id)) ON COMMIT DROP`));
      assert.equal(await isMorningAllowed('unlisted@example.invalid', db), true);
      assert.equal(await isMorningAllowed('ordinary@example.invalid', db), true);
      await db.execute(sql`insert into app_feature_flags values ('voice_calling','{"mode":"none","users":[]}'::jsonb,0)`);
      assert.equal(await isMorningAllowed('unlisted@example.invalid', db), true);
      await db.execute(sql`insert into app_feature_flags values ('daily_proactive','{"mode":"everyone","users":[]}'::jsonb,0)`);
      const owner = 'morning-test@example.invalid', date = '2026-09-15';
      const now = new Date(`${date}T10:00:00Z`);
      await db.execute(sql`insert into user_life_profiles values (${owner}, 'America/Toronto')`);
      await db.execute(sql`insert into mobile_user_states values (${owner}, true)`);
      const original = { decisions: [], tasks: [], history: [], discardedDecisionIds: [], settings: { preserve: true } };
      await db.execute(sql`insert into workspace_states (owner_email,state_json) values (${owner},${JSON.stringify(original)}::jsonb), ('other@example.invalid',${JSON.stringify(original)}::jsonb)`);
      assert.equal((await dueMorningAccounts(now, db)).length, 1);
      assert.equal(await claimMorning(owner, 'America/Toronto', date, now, db), 1);
      assert.equal(await claimMorning(owner, 'America/Toronto', date, now, db), false);
      assert.equal((await dueMorningAccounts(now, db)).length, 0);
      const retryTime = new Date(now.getTime() + 21 * 60000);
      assert.equal(await claimMorning(owner, 'America/Toronto', date, retryTime, db), 2);
      const report: MorningReport = { model: 'gpt-5.6-luna', serviceTier: 'default', localDate: date, ideas: [{
        topicKey: 'test-topic', title: 'Test topic', body: 'A personal next step.', category: 'social', personalReason: 'Actual request.', personalRefs: ['chat:1'], sourceUrls: [], whyNow: 'Timely.', expiresAt: new Date(Date.now() + 86400000).toISOString(), primary: { label: 'Research it', intent: 'Research the topic.', actionType: 'research' }, alternative: { label: 'Wait for now', intent: 'Do nothing.', actionType: 'no_action' },
      }], audit: [{ tool: 'web_search', input: { query: 'public topic' }, result: { private: 'must not persist' } }], usages: [], durationMs: 1, withheld: [], warnings: [] };
      assert.equal((await publishMorning(owner, report, 1, db)).published, 0);
      await failMorning(owner, date, new Error('old worker'), 1, db);
      assert.equal((await db.execute(sql`select status from morning_idea_runs`))[0].status, 'running');
      await db.execute(sql`update app_feature_flags set value='{"mode":"none","users":[]}'::jsonb where key='daily_proactive'`);
      assert.equal((await publishMorning(owner, report, 2, db)).published, 0);
      assert.equal((await dueMorningAccounts(retryTime, db)).length, 0);
      await db.execute(sql`update app_feature_flags set value='{"mode":"everyone","users":[]}'::jsonb where key='daily_proactive'`);
      assert.equal((await db.execute(sql`select * from proactive_candidates`)).length, 0, 'Disabled and stale workers do not notify');
      // A failed enqueue must roll back Home and the completed ledger together.
      await db.execute(sql`alter table push_notification_jobs add constraint reject_test_push check (status <> 'queued')`);
      await assert.rejects(publishMorning(owner, report, 2, db), (error: unknown) => (error as { cause?: { constraint_name?: string } }).cause?.constraint_name === 'reject_test_push');
      assert.equal((await db.execute(sql`select version from workspace_states where owner_email=${owner}`))[0].version, 0);
      assert.equal((await db.execute(sql`select status from morning_idea_runs where owner_email=${owner}`))[0].status, 'running');
      await db.execute(sql`alter table push_notification_jobs drop constraint reject_test_push`);
      assert.equal((await publishMorning(owner, report, 2, db)).published, 1);
      assert.equal((await publishMorning(owner, report, 2, db)).published, 0);
      assert.equal(await claimMorning(owner, 'America/Toronto', date, new Date(now.getTime() + 60 * 60000), db), false);
      const [workspace] = await db.execute<{ version: number; state_json: Omit<typeof original, 'decisions'> & { decisions: Array<{ attentionMode: string }> } }>(sql`select * from workspace_states where owner_email=${owner}`);
      // Qualified morning ideas queue their own message immediately.
      const notifications = await db.execute(sql`select * from push_notification_jobs`);
      assert.equal(notifications.length, 1, 'Retried publication queues exactly one candidate');
      assert.equal(notifications[0].owner_email, owner);
      assert.equal(notifications[0].title, 'Test topic');
      assert.equal(notifications[0].body, 'A personal next step.');
      assert.equal(notifications[0].status, 'queued');
      assert.equal(workspace.version, 1);
      assert.deepEqual(workspace.state_json.settings, original.settings);
      assert.equal((await db.execute(sql`select version from workspace_states where owner_email='other@example.invalid'`))[0].version, 0);
      assert.equal((await db.execute<{ report: { audit: Array<{ result?: unknown }> } }>(sql`select report from morning_idea_runs`))[0].report.audit[0].result, undefined);
      const second = 'retry@example.invalid';
      assert.equal(await claimMorning(second, 'America/Toronto', date, now, db), 1);
      await failMorning(second, date, new Error('provider unavailable'), 1, db);
      const [failure] = await db.execute<{ status: string; lease_until: string }>(sql`select status,lease_until from morning_idea_runs where owner_email=${second}`);
      assert.equal(failure.status, 'failed');
      const afterFailure = new Date(new Date(failure.lease_until).getTime() + 1000);
      // The lease can be released independently of the wall-clock fixture.
      await db.execute(sql`update morning_idea_runs set lease_until=${now.toISOString()}::timestamptz where owner_email=${second}`);
      assert.ok(afterFailure.getTime() > Date.now());
      assert.equal(await claimMorning(second, 'America/Toronto', date, retryTime, db), 2);
      await db.execute(sql`insert into morning_idea_runs (owner_email,local_date,status,report) values
        (${owner}, current_date - 6, 'completed', ${JSON.stringify({ ideas: [{ ...report.ideas[0], topicKey: 'recent-offer' }] })}::jsonb),
        ('other@example.invalid', current_date - 5, 'completed', ${JSON.stringify({ ideas: [{ ...report.ideas[0], topicKey: 'other-owner' }] })}::jsonb),
        (${owner}, current_date - 4, 'failed', ${JSON.stringify({ ideas: [{ ...report.ideas[0], topicKey: 'failed-run' }] })}::jsonb)`);
      await db.execute(sql`insert into morning_idea_runs (owner_email,local_date,status,report) values (${owner}, current_date - 8, 'completed', ${JSON.stringify({ ideas: [{ ...report.ideas[0], topicKey: 'outside-week' }] })}::jsonb)`);
      const prior = await previousMorningIdeas(` ${owner.toUpperCase()} `, db);
      assert.ok(prior.some(day => day.ideas.some(idea => idea.topicKey === 'recent-offer')));
      assert.ok(!prior.some(day => day.ideas.some(idea => idea.topicKey === 'other-owner' || idea.topicKey === 'failed-run' || idea.topicKey === 'outside-week')));
      throw rollback;
    }), error => error === rollback);
  } finally { await client.end(); }
});
