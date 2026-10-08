import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { PostgresRunStore } from "../lib/harness/store";
import { appendConversationReply } from "../lib/harness/conversation-reply";
import { pendingSteering } from "../lib/harness/steering";
import { prepareInteractiveStart } from "../lib/harness/interactive-start";
import { runAgent } from "../lib/harness/run";
import { consumeApiQuota } from "../lib/api-quota";

const url = process.env.REPLY_TEST_DATABASE_URL;
test("reply acceptance is atomic across independent PostgreSQL connections", { skip: !url }, async t => {
  if (!["127.0.0.1", "localhost"].includes(new URL(url!).hostname)) throw new Error("Use a disposable local database.");
  const admin = postgres(url!, { onnotice() {} });
  const schema = `reply_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create schema ${schema}`);
  const queries: string[] = [];
  const sql = postgres(url!, { max: 8, prepare: false, connection: { search_path: schema }, onnotice() {}, debug(_connection, query) { queries.push(query); } });
  const store = new PostgresRunStore(url!, sql);
  const create = async () => {
    const run = await store.createRun({ userId: "test", decisionId: null, category: "test", request: "Initial", title: "Test", metadata: {} });
    await store.appendMessages(run.id, [{ role: "user", content: "Initial" }]);
    await store.updateRun(run.id, { status: "done", response: "Old answer" });
    return run;
  };
  try {
    await t.test("connection preparation releases reservations and respects small pools", async () => {
      for (const max of [1, 2]) {
        const connection = postgres(url!, { max, prepare: false, onnotice() {} });
        try {
          const preparedStore = new PostgresRunStore(url!, connection);
          const first = preparedStore.prepareConnections();
          assert.equal(preparedStore.prepareConnections(), first, "concurrent calls share preparation");
          await first;
          assert.equal(preparedStore.prepareConnections(), first, "warm calls do not reserve again");
          const reservations = await Promise.all(Array.from({ length: max }, () => connection.reserve()));
          try {
            const ids = await Promise.all(reservations.map(async sql => (await sql`select pg_backend_pid() as id`)[0].id));
            assert.equal(new Set(ids).size, max);
          } finally { reservations.forEach(sql => sql.release()); }
        } finally { await connection.end(); }
      }
    });
    for (const file of ["0002_agent_harness.sql", "0003_agent_results_and_secrets.sql", "0015_agent_messages.sql", "0016_scheduled_tasks.sql", "0021_security_boundaries.sql"])
      await sql.unsafe(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    await t.test("creation saves encrypted credentials and opening history in one atomic write", async () => {
      const previous = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = 'local-test-credential-encryption';
      try {
        const input = { userId: 'test', decisionId: null, category: 'test', request: 'Hi', title: 'Atomic credentials', metadata: {} };
        queries.length = 0;
        const run = await store.createRun(input, () => [{ role: 'user', content: 'Hi' }], { google_access_token: 'fixture-token' });
        assert.equal(queries.length, 1);
        assert.equal(await store.getSecret(run.id, 'google_access_token'), 'fixture-token');
        assert.equal((await store.listMessages(run.id)).length, 1);
        const [encrypted] = await sql`select encrypted_value from agent_run_secrets where run_id=${run.id}`;
        assert.ok(!encrypted.encrypted_value.includes('fixture-token'));
        assert.ok(!JSON.stringify(await store.getSnapshot(run.id)).includes('fixture-token'));
        const unseeded = await store.createRun(input, undefined, { google_access_token: 'second-fixture-token' });
        assert.equal(unseeded.status, 'planning');
        assert.equal((await store.listMessages(unseeded.id)).length, 0);
        assert.equal(await store.getSecret(unseeded.id, 'google_access_token'), 'second-fixture-token');
        await sql.unsafe(`create function ${schema}.reject_credentials() returns trigger language plpgsql as $$ begin raise exception 'credential write failed'; end $$`);
        await sql.unsafe(`create trigger reject_credentials before insert on ${schema}.agent_run_secrets for each row execute function ${schema}.reject_credentials()`);
        try {
          await assert.rejects(store.createRun({ ...input, title: 'Rollback credentials' }, () => [{ role: 'user', content: 'Hi' }], { google_access_token: 'fixture-token' }), /credential write failed/);
          assert.equal((await sql`select id from agent_runs where title='Rollback credentials'`).length, 0);
        } finally { await sql.unsafe(`drop trigger reject_credentials on ${schema}.agent_run_secrets`); }
      } finally {
        if (previous === undefined) delete process.env.AUTH_SECRET;
        else process.env.AUTH_SECRET = previous;
      }
    });
    await t.test("completed-history boundary excludes later replies and never advances on failed completion", async () => {
      const run = await create();
      const before = (await store.listMessages(run.id)).at(-1)!.seq;
      await appendConversationReply(store, run.id, 'Good job');
      assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, before, 'legacy done chat is marked before inserting the follow-up');
      await store.appendMessages(run.id, [{ role: 'assistant', content: 'New task result' }]);
      await store.enqueueSteering(run.id, { role: 'user', content: 'Still working' });
      assert.equal(await store.finishRunIfNoSteering(run.id, null), false);
      assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, before);
      await store.consumeSteering(run.id);
      assert.equal(await store.finishRunIfNoSteering(run.id, null, 'failed'), true);
      assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, before);
      await store.updateRun(run.id, { status: 'running' });
      const last = (await store.listMessages(run.id)).at(-1)!.seq;
      assert.equal(await store.finishRunIfNoSteering(run.id, null), true);
      assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, last);
      await appendConversationReply(store, run.id, 'Thanks again');
      assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, last);
      assert.ok((await store.listMessages(run.id)).at(-1)!.seq > last);
    });
    await t.test("batched quota checks preserve limits, concurrency, and short-circuit charging", async () => {
      const at = 1_790_000_000_000;
      const results = await Promise.all(Array.from({ length: 8 }, () => consumeApiQuota('quota@test.invalid', 'run', sql, at)));
      assert.equal(results.filter(result => result.allowed).length, 4);
      const rows = await sql`select bucket,count from api_usage_buckets where owner_email='quota@test.invalid' order by bucket`;
      assert.deepEqual(rows.map(row => row.count), [4,4]);
      await sql`update api_usage_buckets set count=case when bucket='run:60000' then 0 else 39 end where owner_email='quota@test.invalid'`;
      queries.length = 0;
      assert.equal((await consumeApiQuota('quota@test.invalid', 'run', sql, at)).allowed, true);
      assert.equal(queries.length, 1);
      const denied = await consumeApiQuota('quota@test.invalid', 'run', sql, at);
      assert.equal(denied.allowed, false);
      assert.equal(denied.retryAfter, Math.ceil((Math.floor(at / 3_600_000) * 3_600_000 + 3_600_000 - at) / 1000));
      const after = await sql`select bucket,count from api_usage_buckets where owner_email='quota@test.invalid' order by bucket`;
      assert.deepEqual(after.map(row => row.count), [40,2]);
    });
    await t.test("new chat and its opening message are saved atomically", async () => {
      const input = { userId: "test", decisionId: null, category: "test", request: "Hi", title: "Atomic opening", metadata: {} };
      queries.length = 0;
      const run = await store.createRun(input, created => [{ role: 'user', content: `Hi ${created.id}` }]);
      assert.equal(queries.length, 1);
      assert.equal(run.status, 'running');
      assert.deepEqual((await store.listMessages(run.id)).map(row => row.message.content), [`Hi ${run.id}`]);
      await sql.unsafe(`create function ${schema}.reject_opening() returns trigger language plpgsql as $$ begin raise exception 'opening rejected'; end $$`);
      await sql.unsafe(`create trigger reject_opening before insert on ${schema}.agent_messages for each row execute function ${schema}.reject_opening()`);
      try {
        await assert.rejects(store.createRun({ ...input, title: 'Must roll back' }, () => [{ role: 'user', content: 'Hi' }]), /opening rejected/);
        assert.equal((await sql`select id from agent_runs where title='Must roll back'`).length, 0);
      } finally { await sql.unsafe(`drop trigger reject_opening on ${schema}.agent_messages`); }
    });
    await t.test("local and durable starts serialize through the PostgreSQL execution lock", async () => {
      const run = await create();
      await store.updateRun(run.id, { status: 'running' });
      let started!: () => void, finish!: () => void, retained!: () => Promise<void>;
      const entered = new Promise<void>(resolve => { started = resolve; });
      const release = new Promise<void>(resolve => { finish = resolve; });
      let calls = 0;
      const start = prepareInteractiveStart({ enabled: true, store: () => store, keepAlive: work => { retained = work; },
        load: async () => [{ createAgentModel: () => ({ async turn({ onNarration }) { calls++; started(); await release; await onNarration('Done'); } }) }, { runAgent }],
      });
      start(run.id);
      await entered;
      try {
        assert.deepEqual(await runAgent({ runId: run.id, store, model: { async turn() { calls++; } } }), { retryAfterMs: 5000 });
      } finally { finish(); await retained(); }
      assert.equal(calls, 1);
      assert.equal((await store.getRun(run.id))?.status, 'done');
    });
    await t.test("one-query snapshots preserve actions and latest artifact metadata without bytes", async () => {
      const run = await create();
      const action = await store.createAction({ runId: run.id, stepId: null, toolName: 'lookup', risk: 'read', preview: 'Read', input: { query: 'test' } });
      await store.completeAction(action.id, 'executed', { found: true });
      await store.createArtifact({ runId: run.id, actionId: action.id, name: 'result.txt', mimeType: 'text/plain', bytesBase64: Buffer.from('old').toString('base64') });
      const latest = await store.createArtifact({ runId: run.id, actionId: action.id, name: 'result.txt', mimeType: 'text/plain', bytesBase64: Buffer.from('new').toString('base64') });
      queries.length = 0;
      const snapshot = await store.getSnapshot(run.id);
      assert.equal(queries.length, 1);
      assert.equal(snapshot?.status, 'done');
      assert.equal(snapshot?.actions[0].id, action.id);
      assert.deepEqual(snapshot?.actions[0].result, { found: true });
      assert.equal(snapshot?.artifacts.length, 1);
      assert.equal(snapshot?.artifacts[0].id, latest.id);
      assert.ok(!JSON.stringify(snapshot).includes('bytesBase64'));
      queries.length = 0;
      const turn = await store.getTurnSnapshot(run.id);
      assert.equal(queries.length, 1);
      assert.deepEqual(turn?.messages.map(row => row.message.content), ['Initial']);
      assert.deepEqual(turn?.actions, snapshot?.actions);
      assert.deepEqual(turn?.artifacts, snapshot?.artifacts);
      assert.equal('messages' in snapshot!, false, 'ordinary snapshots do not expose the transcript');
      assert.equal(await store.getSnapshot(crypto.randomUUID()), null);
    });
    await t.test("empty steering needs one read and later input still prevents completion", async () => {
      const run = await create();
      await store.updateRun(run.id, { status: "running" });
      queries.length = 0;
      assert.equal(await store.consumeSteering(run.id), false);
      assert.equal(queries.length, 1);
      assert.ok(!queries[0].includes("for update"));
      assert.equal(await appendConversationReply(store, run.id, "New correction"), "steering");
      assert.equal(await store.finishRunIfNoSteering(run.id, null), false);
      const consumed = await Promise.all([store.consumeSteering(run.id), store.consumeSteering(run.id)]);
      assert.equal(consumed.filter(Boolean).length, 1);
      assert.equal((await store.listMessages(run.id)).filter(message => message.message.content === "New correction").length, 1);
    });
    await t.test("worker lock acquisition returns the run without a second connection read", async () => {
      const run = await create();
      queries.length = 0;
      const result = await store.withExecutionLock(run.id, async (_check, loaded) => {
        assert.equal(loaded?.id, run.id);
        assert.equal(loaded?.status, 'done');
        return true;
      }, { loadRun: true });
      assert.deepEqual(result, { acquired: true, value: true });
      assert.equal(queries.length, 3, 'BEGIN, combined lock/read, COMMIT');
    });
    await t.test("turn initialization acknowledges only loaded receipts without moving a newer watermark backwards", async () => {
      const run = await create();
      await store.updateRunMetadata(run.id, { runtimeResultSeq: 8, runtimeResultReadSeq: 3, untouched: true });
      queries.length = 0;
      const initialized = await store.updateRunMetadata(run.id, { replyTyping: false, lifeMemory: { facts: ['retained'] } }, 5);
      assert.equal(queries.length, 1);
      assert.equal(initialized?.metadata.runtimeResultSeq, 8);
      assert.equal(initialized?.metadata.runtimeResultReadSeq, 5);
      assert.equal(initialized?.metadata.untouched, true);
      assert.deepEqual(initialized?.metadata.lifeMemory, { facts: ['retained'] });
      const stale = await store.updateRunMetadata(run.id, { taskWorkStarted: false }, 4);
      assert.equal(stale?.metadata.runtimeResultReadSeq, 5);
      await assert.rejects(store.updateRunMetadata(run.id, {}, -1), /Invalid runtime/);
    });
    await t.test("startup steering preserves first-turn seeding and consumes later input once", async () => {
      const run = await store.createRun({ userId: "test", decisionId: null, category: "test", request: "Original request", title: "Test", metadata: {} });
      await store.updateRun(run.id, { status: "running" });
      await store.enqueueSteering(run.id, { role: "user", content: "Follow-up" });
      queries.length = 0;
      assert.equal(await store.consumeSteering(run.id, true), false);
      assert.equal(queries.length, 1);
      assert.equal((await store.listMessages(run.id)).length, 0);
      await store.appendMessages(run.id, [{ role: "user", content: "Original request" }]);
      assert.equal(await store.consumeSteering(run.id, true), true);
      assert.equal(await store.consumeSteering(run.id, true), false);
      assert.deepEqual((await store.listMessages(run.id)).map(row => row.message.content), ["Original request", "Follow-up"]);
    });
    await t.test("history existence is scoped to the chat and does not load message bodies", async () => {
      const run = await store.createRun({ userId: "test", decisionId: null, category: "test", request: "Initial", title: "Test", metadata: {} });
      assert.equal(await store.hasMessages(run.id), false);
      await store.appendMessages(run.id, [{ role: "user", content: "Large history ".repeat(1000) }]);
      queries.length = 0;
      assert.equal(await store.hasMessages(run.id), true);
      assert.match(queries[0], /select 1 from agent_messages.*limit 1/);
      assert.equal(await store.hasMessages(crypto.randomUUID()), false);
    });
    await t.test("parallel replies start one turn and queue every other message exactly once", async () => {
      const run = await create();
      const replies = Array.from({ length: 8 }, (_, i) => `Reply ${i}`);
      const results = await Promise.all(replies.map(text => appendConversationReply(store, run.id, text, [], undefined, { appleConnections: { connected: true } })));
      assert.equal(results.filter(value => value === "started").length, 1);
      assert.equal(results.filter(value => value === "steering").length, 7);
      assert.equal(pendingSteering(await store.getRun(run.id)).length, 7);
      await store.consumeSteering(run.id);
      const messages = await store.listMessages(run.id);
      assert.equal(messages.length, 9);
      assert.equal(new Set(messages.map(message => message.seq)).size, 9);
      for (const reply of replies) assert.equal(messages.filter(message => message.message.content === reply).length, 1);
    });
    await t.test("rejected message storage rolls back the running state and metadata", async () => {
      const run = await create();
      await sql`alter table agent_messages add constraint rejected_test_message check (message->>'content' <> 'reject-me')`;
      await assert.rejects(appendConversationReply(store, run.id, "reject-me", [], undefined, { shouldNotPersist: true }));
      const after = await store.getRun(run.id);
      assert.equal(after?.status, "done");
      assert.equal(after?.response, "Old answer");
      assert.equal(after?.metadata.shouldNotPersist, undefined);
      assert.equal((await store.listMessages(run.id)).length, 1);
      await sql`alter table agent_messages drop constraint rejected_test_message`;
    });
    await t.test("pending automatic wait stays blocked, armed wait can be superseded", async () => {
      const run = await create();
      await store.updateRun(run.id, { status: "paused" });
      await store.updateRunMetadata(run.id, { automaticPause: { id: "pause", ready: false }, pauseDispatchId: "pause" });
      await assert.rejects(appendConversationReply(store, run.id, "Continue"), /resuming/);
      await store.updateRunMetadata(run.id, { automaticPause: { id: "pause", ready: true } });
      assert.equal(await appendConversationReply(store, run.id, "Continue"), "started");
      assert.equal((await store.getRun(run.id))?.metadata.automaticPause, undefined);
      assert.equal((await store.getRun(run.id))?.metadata.pauseDispatchId, undefined);
    });
    await t.test("previous result and reply context survive the atomic transition", async () => {
      const run = await create();
      await store.updateRun(run.id, { result: { outcome: "completed", summary: "Old result", details: "Details", verified: true, externalChange: false, facts: [], links: [], moneySaved: null, recommendedNextStep: null } });
      await store.updateRunMetadata(run.id, { modelRetryAt: Date.now() + 60_000, modelNotFoundRetries: 2, reactionResumeStatus: "paused" });
      const replyTo = { messageId: "earlier", role: "agent" as const, text: "Earlier answer" };
      assert.equal(await appendConversationReply(store, run.id, "Next question", [], replyTo), "started");
      const messages = await store.listMessages(run.id);
      assert.equal(messages.length, 3);
      assert.match(String(messages[1].message.content), /Old result/);
      assert.deepEqual(messages[2].message.providerOptions?.wdyt?.replyTo, replyTo);
      const after = await store.getRun(run.id);
      assert.equal(after?.result, null);
      assert.equal(after?.metadata.modelRetryAt, null);
      assert.equal(after?.metadata.modelNotFoundRetries, 0);
      assert.equal(after?.metadata.reactionResumeStatus, null);
    });
    await t.test("batched credentials stay encrypted and update only supplied keys", async () => {
      const run = await create();
      const old = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = "local-encryption-test-only-secret";
      try {
        await store.putSecrets(run.id, { first: "secret-one", second: "secret-two" });
        await store.putSecrets(run.id, { first: "updated-one" });
        assert.equal(await store.getSecret(run.id, "first"), "updated-one");
        assert.equal(await store.getSecret(run.id, "second"), "secret-two");
        queries.length = 0;
        assert.deepEqual(await store.getSecrets(run.id, ['first','second','missing']), { first: 'updated-one', second: 'secret-two' });
        assert.equal(queries.length, 1);
        assert.deepEqual(await store.getSecrets(crypto.randomUUID(), ['first']), {});
        assert.deepEqual(await store.getSecrets(run.id, []), {});
        const rows = await sql`select encrypted_value from agent_run_secrets where run_id=${run.id}`;
        assert.ok(rows.every(row => String(row.encrypted_value).startsWith("v1.") && !String(row.encrypted_value).includes("secret-")));
      } finally { if (old === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = old; }
    });
  } finally {
    await sql.end();
    await admin.unsafe(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
