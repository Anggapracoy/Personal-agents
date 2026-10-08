import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { PostgresRunStore } from "../lib/harness/store";
import { threadItems } from "../lib/harness/thread";
import { checkPhoneCall } from "../lib/harness/phone-monitor";
import { PauseStore } from "../lib/pauses/store";
import type { PauseDefinition } from "../lib/pauses/definition";

const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
test("automatic waits against PostgreSQL", { skip: !databaseUrl }, async t => {
  const admin = postgres(databaseUrl!, { prepare: false, onnotice: () => {} });
  const schema = `pause_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create schema ${schema}`);
  const sql = postgres(databaseUrl!, { prepare: false, connection: { search_path: schema }, onnotice: () => {} });
  const pauses = new PauseStore(sql), runs = new PostgresRunStore(databaseUrl!, sql);
  const now = new Date("2026-09-06T12:00:00Z"), due = new Date("2026-09-06T13:30:00Z");
  const definition: PauseDefinition = { reason: "Waiting for the next update", resumeInstructions: "Check the latest result and finish.", condition: { type: "time", hours: 1, minutes: 30 } };
  const newRun = async () => {
    const run = await runs.createRun({ userId: "owner@example.com", decisionId: null, category: "social", request: "Complete this after waiting", title: "Waiting task", metadata: { actionScopeId: "original-scope", scheduleExecution: { occurrenceId: "original-occurrence" } } });
    await runs.updateRun(run.id, { status: "running" });
    await runs.appendMessages(run.id, [{ role: "user", content: run.request }, { role: "assistant", content: "I’ll check again when the wait ends." }]);
    return run.id;
  };
  const save = (runId: string, creationKey = crypto.randomUUID()) => pauses.create({ runId, ownerEmail: "owner@example.com", creationKey, definition }, now);
  const reset = async () => { await sql`truncate agent_runs cascade`; };
  try {
    for (const file of ["0002_agent_harness.sql", "0003_agent_results_and_secrets.sql", "0015_agent_messages.sql", "0016_scheduled_tasks.sql", "0017_agent_pauses.sql"]) await sql.unsafe(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    await sql.unsafe(await readFile(new URL("../db/migrations/0017_agent_pauses.sql", import.meta.url), "utf8"));
    await t.test("duration cannot fire until checkpoint; duplicate saves and dispatches resume once", async () => {
      const runId = await newRun(), key = crypto.randomUUID();
      const saved = await save(runId, key);
      assert.equal((await save(runId, key)).id, saved.id);
      assert.equal(saved.wakeAt, due.toISOString());
      assert.equal((await pauses.sweep(due)).length, 0);
      assert.equal(await runs.claimRunForReply(runId), false);
      await pauses.arm(runId, saved.id);
      assert.equal((await pauses.sweep(new Date(due.getTime() - 1))).length, 0);
      assert.equal((await pauses.sweep(due)).length, 1);
      const prepared = await Promise.all(Array.from({ length: 8 }, () => pauses.prepare(saved.id)));
      assert.ok(prepared.every(id => id === runId));
      assert.equal((await runs.listMessages(runId)).length, 3);
      const run = (await runs.getRun(runId))!;
      assert.equal(run.status, "planning");
      assert.equal(run.metadata.automaticPause, undefined);
      assert.equal(run.metadata.actionScopeId, "original-scope");
      assert.deepEqual(run.metadata.scheduleExecution, { occurrenceId: "original-occurrence" });
      assert.equal(run.metadata.pauseDispatchId, saved.id);
      const visible = threadItems((await runs.getSnapshot(runId))!, await runs.listMessages(runId));
      assert.deepEqual(visible.map(item => item.kind), ["user", "agent"]);
      assert.ok(visible.every(item => !("text" in item) || !item.text.includes("[runtime]")));
      await runs.appendMessages(runId, [{ role: "assistant", content: "The updated result is ready." }]);
      assert.deepEqual(threadItems((await runs.getSnapshot(runId))!, await runs.listMessages(runId)).map(item => item.kind), ["user", "agent", "agent"]);
      // A dispatcher crash between prepare and send is recovered from the outbox.
      assert.equal((await pauses.sweep(due)).length, 1);
      await runs.updateRun(runId, { status: "running" });
      assert.equal((await pauses.sweep(due)).length, 0);
      assert.equal(await pauses.prepare(saved.id), null);
      await reset();
    });
    await t.test("user replies invalidate old waits and may create another immediately", async () => {
      const runId = await newRun(), saved = await save(runId);
      await pauses.arm(runId, saved.id);
      assert.equal(await runs.claimRunForReply(runId), true);
      await runs.appendMessages(runId, [{ role: "user", content: "Actually wait two hours." }]);
      assert.equal((await runs.getRun(runId))?.metadata.automaticPause, undefined);
      const next = await save(runId);
      assert.notEqual(next.id, saved.id);
      await pauses.arm(runId, saved.id);
      assert.equal((await runs.getRun(runId))?.metadata.automaticPause && ((await runs.getRun(runId))!.metadata.automaticPause as { ready: boolean }).ready, false);
      await pauses.markReady(saved.id, { kind: "late_old_event" });
      assert.equal(await pauses.prepare(saved.id), null);
      assert.equal((await runs.getRun(runId))?.status, "paused");
      assert.equal((await runs.listMessages(runId)).length, 3);
      await reset();
    });
    await t.test("cancellation wins against stale delivery and clears dispatch token", async () => {
      const runId = await newRun(), saved = await save(runId);
      await pauses.arm(runId, saved.id); await pauses.sweep(due);
      await Promise.all([pauses.prepare(saved.id), runs.updateRun(runId, { status: "cancelled" })]);
      const run = (await runs.getRun(runId))!;
      assert.equal(run.status, "cancelled");
      assert.equal(run.metadata.pauseDispatchId, undefined);
      assert.equal(run.metadata.automaticPause, undefined);
      assert.equal(await pauses.prepare(saved.id), null);
      assert.equal((await pauses.sweep(due)).length, 0);
      await reset();
    });
    await t.test("accepted concurrent user reply is never overwritten by a wake", async () => {
      const runId = await newRun(), saved = await save(runId);
      await pauses.arm(runId, saved.id); await pauses.sweep(due);
      const [claimed, resumed] = await Promise.all([runs.claimRunForReply(runId), pauses.prepare(saved.id)]);
      if (claimed) {
        assert.equal(resumed, null);
        assert.equal((await runs.getRun(runId))?.status, "running");
        assert.equal((await runs.listMessages(runId)).length, 2);
      } else {
        assert.equal(resumed, runId);
        assert.equal((await runs.getRun(runId))?.status, "planning");
      }
      await reset();
    });
    await t.test("email replies wake before the deadline and duplicate events coalesce", async () => {
      const runId = await newRun(), connectionId = crypto.randomUUID();
      const eventDefinition: PauseDefinition = { ...definition, condition: { type: "event", event: { kind: "gmail_reply", connectionId, threadId: "thread-one", afterMessageId: "sent-one", sender: "person@example.com" } } };
      await assert.rejects(() => pauses.create({ runId, ownerEmail: "other@example.com", creationKey: crypto.randomUUID(), definition }, now), /Conversation not found/);
      await assert.rejects(() => pauses.create({ runId, ownerEmail: "owner@example.com", creationKey: crypto.randomUUID(), definition: eventDefinition }, now), /verified connected account/);
      const saved = await pauses.create({ runId, ownerEmail: "owner@example.com", creationKey: crypto.randomUUID(), definition: eventDefinition, connectionId, baseline: { ids: ["sent-one"], since: now.toISOString(), accountEmail: "owner@example.com" } }, now);
      await pauses.arm(runId, saved.id);
      assert.equal((await pauses.sweep(new Date(now.getTime() + 60_000))).length, 0);
      assert.equal((await pauses.events(crypto.randomUUID())).length, 0);
      assert.equal((await pauses.events(connectionId)).length, 1);
      await Promise.all(Array.from({ length: 4 }, () => pauses.markReady(saved.id, { kind: "gmail_reply", messageId: "new-reply" })));
      await Promise.all(Array.from({ length: 4 }, () => pauses.prepare(saved.id)));
      const messages = await runs.listMessages(runId);
      assert.equal(messages.length, 3);
      assert.match(String(messages[2].message.content), /new-reply/);
      await reset();
    });
    await t.test("email timeout resumes once and instructs fresh inbox recovery; late replies cannot overwrite it", async () => {
      const runId = await newRun(), connectionId = crypto.randomUUID();
      const eventDefinition: PauseDefinition = { ...definition, condition: { type: "event", event: { kind: "gmail_reply", connectionId, threadId: "bounced-thread", afterMessageId: "sent", sender: "obsolete@example.com", timeoutMinutes: 30 } } };
      const saved = await pauses.create({ runId, ownerEmail: "owner@example.com", creationKey: crypto.randomUUID(), definition: eventDefinition, connectionId, baseline: { ids: ["sent"], since: now.toISOString(), accountEmail: "owner@example.com" } }, now);
      const deadline = new Date(now.getTime() + 30 * 60_000);
      assert.equal(saved.wakeAt, deadline.toISOString());
      assert.equal((await pauses.sweep(deadline)).length, 0);
      await pauses.arm(runId, saved.id);
      assert.equal((await pauses.sweep(new Date(deadline.getTime() - 1))).length, 0);
      assert.equal((await pauses.sweep(deadline)).length, 1);
      await pauses.markReady(saved.id, { kind: "gmail_reply", messageId: "late" });
      await Promise.all([pauses.prepare(saved.id), pauses.prepare(saved.id)]);
      const messages = await runs.listMessages(runId);
      assert.equal(messages.length, 3);
      assert.match(String(messages[2].message.content), /email_wait_timeout/);
      assert.match(String(messages[2].message.content), /other threads/);
      assert.match(String(messages[2].message.content), /does not establish that no reply arrived/);
      assert.equal(((await runs.getRun(runId))!.metadata.executionContext as { sourceAccountId: string }).sourceAccountId, connectionId);
      await reset();
    });
    await t.test("legacy email waits get a 48-hour deadline without bypassing checkpoint or cancellation", async () => {
      const runId = await newRun(), connectionId = crypto.randomUUID();
      const eventDefinition: PauseDefinition = { ...definition, condition: { type: "event", event: { kind: "gmail_reply", connectionId, threadId: "legacy", afterMessageId: null, sender: null } } };
      const saved = await pauses.create({ runId, ownerEmail: "owner@example.com", creationKey: crypto.randomUUID(), definition: eventDefinition, connectionId, baseline: { ids: [], since: now.toISOString(), accountEmail: "owner@example.com" } }, now);
      await sql`update agent_pauses set wake_at=null where id=${saved.id}`;
      await runs.updateRunMetadata(runId, { automaticPause: { ...saved, wakeAt: null } });
      const deadline = new Date(now.getTime() + 48 * 3600_000);
      assert.equal((await pauses.sweep(deadline)).length, 0);
      const [row] = await sql`select wake_at from agent_pauses where id=${saved.id}`;
      assert.equal(new Date(row.wake_at).toISOString(), deadline.toISOString());
      assert.equal(new Date(((await runs.getRun(runId))!.metadata.automaticPause as { wakeAt: string }).wakeAt).toISOString(), deadline.toISOString());
      await pauses.arm(runId, saved.id);
      await runs.updateRun(runId, { status: "cancelled" });
      assert.equal((await pauses.sweep(deadline)).length, 0);
      assert.equal(await pauses.prepare(saved.id), null);
      await reset();
    });
    await t.test("phone completion monitors durable evidence, waits for checkpoint, and resumes once", async () => {
      const ownerEmail = "owner@example.invalid";
      const runId = await newRun();
      await sql`update agent_runs set user_id=${ownerEmail} where id=${runId}`;
      const action = await runs.createAction({ runId, stepId: null, toolName: "phone_call", risk: "write_external", input: {}, preview: "Call" });
      await sql`update agent_actions set status='executed',result='{"callId":"call_test"}'::jsonb,executed_at=now() where id=${action.id}`;
      const phone: PauseDefinition = { reason: "Calling the restaurant", resumeInstructions: "Read the call outcome and continue without redialing.", condition: { type: "phone_call", callId: "call_test", actionId: action.id, phoneNumber: "+16475550100", recipientName: "Restaurant", status: "queued" } };
      const saved = await pauses.create({ runId, ownerEmail, creationKey: `phone:${action.id}`, definition: phone });
      assert.equal(saved.wakeAt, null);
      let checks = 0;
      const request: typeof fetch = async () => { checks++; return Response.json({ id: "call_test", status: checks === 1 ? "in_progress" : "completed", transcript: "Table confirmed", outcome: "achieved" }); };
      assert.equal((await checkPhoneCall(saved.id, { store: pauses, key: "test", request })).state, "inactive");
      assert.equal(checks, 0);
      await pauses.arm(runId, saved.id);
      assert.equal((await pauses.sweep(new Date("2030-01-01"))).length, 0);
      assert.equal((await checkPhoneCall(saved.id, { store: pauses, key: "test", request })).state, "pending");
      assert.equal(((await runs.getRun(runId))!.metadata.automaticPause as any).phoneCall.status, "in_progress");
      assert.equal((await checkPhoneCall(saved.id, { store: pauses, key: "test", request })).state, "ready");
      assert.equal(((await runs.getAction(action.id, runId))!.result!.callResult as any).transcript, "Table confirmed");
      assert.equal((await checkPhoneCall(saved.id, { store: pauses, key: "test", request })).state, "inactive");
      await Promise.all([pauses.prepare(saved.id), pauses.prepare(saved.id)]);
      assert.equal((await runs.getRun(runId))!.status, "planning");
      assert.equal((await runs.listMessages(runId)).length, 3);
      await reset();
    });
    await t.test("Resia lifecycle and duplicate webhooks preserve the durable checkpoint and resume once", async () => {
      const runId = await newRun();
      const action = await runs.createAction({ runId, stepId: null, toolName: "phone_call", risk: "write_external", input: {}, preview: "Call" });
      await sql`update agent_actions set status='executed',result='{"provider":"resia","callId":"resia_lifecycle"}'::jsonb where id=${action.id}`;
      const saved = await pauses.create({ runId, ownerEmail: "owner@example.com", creationKey: `phone:${action.id}`, definition: { reason: "Calling", resumeInstructions: "Read result", condition: { type: "phone_call", callId: "resia_lifecycle", actionId: action.id, phoneNumber: "+16475550100", recipientName: "Restaurant", status: "queued" } } });
      assert.equal((await pauses.phoneCallsByProviderId("resia_lifecycle")).length, 0);
      await pauses.arm(runId, saved.id);
      assert.equal((await pauses.phoneCallsByProviderId("resia_lifecycle")).length, 1);
      assert.equal((await pauses.phoneCallsByProviderId("other_call")).length, 0);
      for (const status of ["initiated", "post_processing", "unknown"]) {
        const result = await checkPhoneCall(saved.id, { store: pauses, key: "test", request: async () => Response.json({ id: "resia_lifecycle", status }) });
        assert.equal(result.state, "pending");
        assert.equal((await runs.getRun(runId))!.status, "paused");
        assert.equal(((await runs.getAction(action.id, runId))!.result!.callResult as any).status, status);
      }
      assert.equal((await checkPhoneCall(saved.id, { store: pauses, key: "test", request: async () => Response.json({ id: "resia_lifecycle", status: "canceled" }) })).state, "ready");
      assert.equal((await pauses.phoneCallsByProviderId("resia_lifecycle")).length, 0);
      await Promise.all([pauses.prepare(saved.id), pauses.prepare(saved.id)]);
      assert.equal((await runs.getRun(runId))!.status, "planning");
      assert.equal((await runs.listMessages(runId)).length, 3);
      await reset();
    });
    await t.test("phone monitoring respects cancellation and reports repeated provider failures without claiming completion", async () => {
      const ownerEmail = "owner@example.invalid";
      const make = async () => {
        const runId = await newRun();
        await sql`update agent_runs set user_id=${ownerEmail} where id=${runId}`;
        const action = await runs.createAction({ runId, stepId: null, toolName: "phone_call", risk: "write_external", input: {}, preview: "Call" });
        await sql`update agent_actions set status='executed',result='{"callId":"call_fail"}'::jsonb where id=${action.id}`;
        const saved = await pauses.create({ runId, ownerEmail, creationKey: `phone:${action.id}`, definition: { reason: "Calling", resumeInstructions: "Inspect same call", condition: { type: "phone_call", callId: "call_fail", actionId: action.id, phoneNumber: "+16475550100", recipientName: "Restaurant", status: "queued" } } });
        await pauses.arm(runId, saved.id);
        return { runId, saved };
      };
      const first = await make();
      const request: typeof fetch = async () => new Response("Unavailable", { status: 503 });
      assert.equal((await checkPhoneCall(first.saved.id, { store: pauses, key: "test", request })).state, "pending");
      assert.equal((await checkPhoneCall(first.saved.id, { store: pauses, key: "test", request })).state, "pending");
      assert.equal((await checkPhoneCall(first.saved.id, { store: pauses, key: "test", request })).state, "ready");
      const [failure] = await sql`select wake_reason from agent_pauses where id=${first.saved.id}`;
      assert.equal(failure.wake_reason.kind, "phone_monitor_failed");
      assert.match(failure.wake_reason.message, /does not mean the call ended/);
      await reset();
      const second = await make();
      const cancelledDuringFetch: typeof fetch = async () => {
        await runs.updateRun(second.runId, { status: "cancelled" });
        return Response.json({ id: "call_fail", status: "completed" });
      };
      await checkPhoneCall(second.saved.id, { store: pauses, key: "test", request: cancelledDuringFetch });
      assert.equal(await pauses.prepare(second.saved.id), null);
      assert.equal((await runs.getRun(second.runId))!.status, "cancelled");
      assert.equal((await pauses.sweep()).length, 0);
      await reset();
    });
    await t.test("event failure counters reset after a successful check", async () => {
      const runId = await newRun(), saved = await save(runId);
      await pauses.arm(runId, saved.id);
      assert.equal(await pauses.recordCheckFailure(saved.id), 1);
      assert.equal(await pauses.recordCheckFailure(saved.id), 2);
      await pauses.resetCheckFailures(saved.id);
      assert.equal(await pauses.recordCheckFailure(saved.id), 1);
      await reset();
    });
  } finally {
    await sql.end();
    await admin.unsafe(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
