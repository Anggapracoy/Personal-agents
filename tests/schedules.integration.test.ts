import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { PostgresRunStore } from "../lib/harness/store";
import { consumeUserSteering } from "../lib/harness/run";
import { ScheduleStore } from "../lib/schedules/store";
import type { ScheduleDefinition } from "../lib/schedules/timing";

const databaseUrl=process.env.SCHEDULE_TEST_DATABASE_URL;
test("scheduled delivery against PostgreSQL",{skip:!databaseUrl},async t=>{
  // Dedicated disposable schema. Never read DATABASE_URL or touch application data.
  const admin=postgres(databaseUrl!,{prepare:false,onnotice:()=>{}});
  const schema=`schedule_test_${crypto.randomUUID().replaceAll("-","")}`;
  await admin.unsafe(`create schema ${schema}`);
  const sql=postgres(databaseUrl!,{prepare:false,connection:{search_path:schema},onnotice:()=>{}});
  const store=new ScheduleStore(sql);
  const now=new Date("2026-09-06T12:00:00Z"),due=new Date("2026-09-06T12:01:00Z");
  const definition:ScheduleDefinition={title:"Call Dad",kind:"reminder",instructions:"Call Dad",timeZone:"America/Toronto",firstRunAt:due.toISOString(),recurrence:null,endAt:null,scheduleLabel:"Today at 8:01 AM",notifyPolicy:"always"};
  const newRun=async()=>{const [r]=await sql`insert into agent_runs(user_id,category,request,title,status,response) values ('owner@example.com','social','Remind me to call Dad','Call Dad','done','I’ll remind you.') returning id`;return String(r.id)};
  const reset=async()=>{await sql`truncate agent_runs cascade`;await sql`truncate push_notification_jobs`};
  try{
    for(const file of ["0002_agent_harness.sql","0003_agent_results_and_secrets.sql","0010_remote_push_notifications.sql","0015_agent_messages.sql","0016_scheduled_tasks.sql"]) await sql.unsafe(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),"utf8"));
    // Migration can be replayed by the deployment flow.
    await sql.unsafe(await readFile(new URL("../db/migrations/0016_scheduled_tasks.sql",import.meta.url),"utf8"));
    await t.test("run patches and message appends are safe under concurrent delivery",async()=>{
      const runs=new PostgresRunStore(databaseUrl!,sql);
      const runId=await newRun();
      await Promise.all([runs.updateRun(runId,{response:"Latest reply"}),runs.updateRun(runId,{status:"cancelled"})]);
      const patched=await runs.getRun(runId);assert.equal(patched?.status,"cancelled");assert.equal(patched?.response,"Latest reply");
      await Promise.all(Array.from({length:8},(_,i)=>runs.appendMessages(runId,[{role:"assistant",content:`Message ${i}`}])));
      const messages=await runs.listMessages(runId);assert.equal(messages.length,8);assert.equal(new Set(messages.map(m=>m.seq)).size,8);
      const claims=await Promise.all([runs.claimRunForReply(runId),runs.claimRunForReply(runId)]);assert.equal(claims.filter(Boolean).length,1);
      const action=await runs.createAction({runId,stepId:crypto.randomUUID(),scopeId:"first",toolName:"test",risk:"write_reversible",preview:"Test",input:{a:1}});
      assert.equal((await runs.findMatchingAction(runId,"test",{a:1},"first"))?.id,action.id);
      assert.equal(await runs.findMatchingAction(runId,"test",{a:1},"second"),null);
      await reset();
    });
    await t.test("steering enqueues atomically and cannot race past finalization", async () => {
      const runs = new PostgresRunStore(databaseUrl!, sql);
      const runId = await newRun();
      await runs.updateRun(runId, { status: "running" });
      const accepted = await Promise.all(Array.from({ length: 8 }, (_, i) => runs.enqueueSteering(runId, { role: "user", content: `Constraint ${i}` })));
      assert.ok(accepted.every(Boolean));
      assert.equal(await runs.finishRunIfNoSteering(runId, null), false);
      await runs.appendMessages(runId, [{ role: "assistant", content: "Previous tool finished" }]);
      const consumed = await Promise.all([runs.consumeSteering(runId), runs.consumeSteering(runId)]);
      assert.equal(consumed.filter(Boolean).length, 1);
      const messages = await runs.listMessages(runId);
      assert.equal(messages.length, 9);
      assert.deepEqual(messages.map(m => m.seq), [1,2,3,4,5,6,7,8,9]);
      assert.equal(messages[0].message.content, "Previous tool finished");
      const [finished, queued] = await Promise.all([runs.finishRunIfNoSteering(runId, null), runs.enqueueSteering(runId, { role: "user", content: "Last correction" })]);
      assert.notEqual(finished, queued);
      if (queued) { assert.equal(await runs.consumeSteering(runId), true); assert.equal(await runs.finishRunIfNoSteering(runId, null), true); }
      assert.equal((await runs.getRun(runId))?.status, "done");
      await reset();
    });
    await t.test("duplicate saves and concurrent deliveries produce exactly one reminder and push",async()=>{
      const runId=await newRun();
      const saved=await store.create("owner@example.com",runId,definition,"one",now);
      const again=await store.create("owner@example.com",runId,definition,"one",new Date("2026-09-07"));
      assert.equal(saved.id,again.id);
      assert.equal((await store.enqueueDue(now)).length,0);
      const pending=await store.enqueueDue(due);assert.equal(pending.length,1);
      await Promise.all(Array.from({length:5},()=>store.prepare(String(pending[0].id),due)));
      assert.equal(Number((await sql`select count(*) from agent_messages`)[0].count),1);
      assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count),1);
      assert.equal((await store.list("owner@example.com"))[0].status,"completed");
      assert.equal((await sql`select response from agent_runs where id=${runId}`)[0].response,"Reminder: Call Dad");
      assert.equal((await store.enqueueDue(new Date("2026-09-07"))).length,0);await reset();
    });
    await t.test("ownership is enforced for creation, listing, and mutation",async()=>{
      const runId=await newRun();const saved=await store.create("owner@example.com",runId,definition,"owner",now);
      assert.deepEqual(await store.list("other@example.com"),[]);
      await assert.rejects(()=>store.create("other@example.com",runId,definition,"other",now),/Conversation not found/);
      await assert.rejects(()=>store.update("other@example.com",saved.id,{status:"cancelled"},now),/Schedule not found/);await reset();
    });
    await t.test("cancel and edit invalidate already queued work",async()=>{
      const runId=await newRun();const saved=await store.create("owner@example.com",runId,definition,"edit",now);
      const [pending]=await store.enqueueDue(due);
      await store.update("owner@example.com",saved.id,{definition:{...definition,firstRunAt:"2026-09-06T13:00:00Z"}},due);
      assert.equal((await store.prepare(String(pending.id),due)).kind,"skip");
      const [next]=await store.enqueueDue(new Date("2026-09-06T13:00:00Z"));
      await store.update("owner@example.com",saved.id,{status:"cancelled"},due);
      assert.equal((await store.prepare(String(next.id),due)).kind,"skip");
      assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count),0);await reset();
    });
    await t.test("pause/resume preserves recurrence without catching up missed runs",async()=>{
      const runId=await newRun();const saved=await store.create("owner@example.com",runId,{...definition,recurrence:{type:"interval",minutes:60}},"pause",now);
      await store.update("owner@example.com",saved.id,{status:"paused"},now);
      assert.equal((await store.enqueueDue(new Date("2026-09-06T16:00:00Z"))).length,0);
      const resumed=await store.update("owner@example.com",saved.id,{status:"active"},new Date("2026-09-06T16:00:00Z"));
      assert.equal(resumed.nextRunAt,"2026-09-06T16:01:00.000Z");await reset();
    });
    await t.test("busy conversations defer agent work and retries seed only one turn",async()=>{
      const runId=await newRun();await store.create("owner@example.com",runId,{...definition,kind:"task"},"task",now);
      await sql`update agent_runs set status='running' where id=${runId}`;
      const [pending]=await store.enqueueDue(due);
      assert.equal((await store.prepare(String(pending.id),due)).kind,"skip");
      await sql`update agent_runs set status='done' where id=${runId}`;
      assert.equal((await store.prepare(String(pending.id),due)).kind,"agent");
      assert.equal((await store.prepare(String(pending.id),due)).kind,"agent");
      assert.equal(Number((await sql`select count(*) from agent_messages`)[0].count),1);
      await sql`update agent_runs set status='done',response='Finished the work.' where id=${runId}`;
      assert.equal((await store.finish(runId,due)).notified,true);
      await store.finish(runId,due);
      assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count),1);await reset();
    });
    await t.test("always-notify tasks with silent or empty results finish without any push", async () => {
      for (const disposition of ["silent", "reaction", null]) {
        const runId = await newRun();
        await store.create("owner@example.com", runId, { ...definition, kind: "task", notifyPolicy: "always" }, `quiet-${disposition}`, now);
        const [pending] = await store.enqueueDue(due);
        await store.prepare(String(pending.id), due);
        await sql`update agent_runs set status='done',response='',result=null,metadata=metadata || ${sql.json({ responseDisposition: disposition })} where id=${runId}`;
        assert.equal((await store.finish(runId, due)).notified, false);
        assert.equal((await store.finish(runId, due)).notified, false);
        assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count), 0);
        assert.equal((await store.list("owner@example.com"))[0].status, "completed");
        await reset();
      }
    });
    await t.test("reminders deliver while a conversation is busy without replacing its live response",async()=>{
      const runId=await newRun();await store.create("owner@example.com",runId,definition,"busy-reminder",now);
      await sql`update agent_runs set status='running',response='Working now' where id=${runId}`;
      const [pending]=await store.enqueueDue(due);await store.prepare(String(pending.id),due);
      const [run]=await sql`select * from agent_runs where id=${runId}`;
      assert.equal(run.status,"running");assert.equal(run.response,"Working now");
      assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count),1);await reset();
    });
    await t.test("quiet checks save observations and restore the existing conversation",async()=>{
      const runId=await newRun();const saved=await store.create("owner@example.com",runId,{...definition,kind:"check",notifyPolicy:"when_relevant",recurrence:{type:"interval",minutes:60}},"check",now);
      const [pending]=await store.enqueueDue(due);await store.prepare(String(pending.id),due);
      const check={notify:false,observation:"Price remains $200. Source: https://example.com/item",summary:"No price change."};
      await sql`update agent_runs set status='done',response='No price change.',metadata=metadata || ${sql.json({scheduledCheckResult:check})} where id=${runId}`;
      assert.equal((await store.finish(runId,due)).notified,false);
      assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count),0);
      assert.equal((await sql`select response from agent_runs where id=${runId}`)[0].response,"I’ll remind you.");
      const [state]=await store.list("owner@example.com");assert.equal(state.lastObservation,check.observation);assert.equal(state.lastNotifiedObservation,null);assert.equal(state.nextRunAt,"2026-09-06T13:01:00.000Z");
      // A fresh occurrence gets the previous observation, not a second schedule.
      const [second]=await store.enqueueDue(new Date("2026-09-06T13:01:00Z"));await store.prepare(String(second.id),new Date("2026-09-06T13:01:00Z"));
      const [run]=await sql`select metadata from agent_runs where id=${runId}`;assert.equal(run.metadata.scheduleExecution.lastObservation,check.observation);assert.equal(run.metadata.scheduleExecution.scheduleId,saved.id);await reset();
    });
    await t.test("a completed occurrence does not stop an ongoing recurring task", async () => {
      const runId = await newRun();
      await store.create("owner@example.com", runId, { ...definition, kind: "task", recurrence: { type: "interval", minutes: 5 } }, "ongoing-task", now);
      const [pending] = await store.enqueueDue(due); await store.prepare(String(pending.id), due);
      await sql`update agent_runs set status='done',response='Daily report ready.',metadata=metadata || ${sql.json({ scheduledCheckResult: { completed: false, notify: true, observation: "Report delivered", summary: "Daily report ready." } })} where id=${runId}`;
      await store.finish(runId, due);
      const [state] = await store.list("owner@example.com");
      assert.equal(state.status, "active"); assert.equal(state.nextRunAt, "2026-09-06T12:06:00.000Z");
      await reset();
    });
    for (const kind of ["task", "check"] as const) await t.test(`a fulfilled ${kind} stops before its deadline and sends its final notification exactly once`, async () => {
      const runId = await newRun();
      const saved = await store.create("owner@example.com", runId, { ...definition, kind, notifyPolicy: kind === "task" ? "always" : "when_relevant", recurrence: { type: "interval", minutes: 15 }, endAt: "2026-09-07T10:00:00Z", instructions: "Check until this game ends, then notify and stop." }, "game", now);
      const [pending] = await store.enqueueDue(due); await store.prepare(String(pending.id), due);
      const check = { completed: true, notify: false, observation: "Official scoreboard: final. https://example.com/game", summary: "The game is final. I’ve stopped checking." };
      await sql`update agent_runs set status='done',response=${check.summary},metadata=metadata || ${sql.json({ scheduledCheckResult: check })} where id=${runId}`;
      const results = await Promise.all([store.finish(runId, due), store.finish(runId, due)]);
      assert.equal(results.filter(result => result.notified).length, 1);
      const [state] = await store.list("owner@example.com");
      assert.equal(state.id, saved.id); assert.equal(state.status, "completed"); assert.equal(state.nextRunAt, null);
      assert.equal(state.lastNotifiedObservation, check.observation);
      assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count), 1);
      assert.equal((await sql`select status from scheduled_occurrences where id=${pending.id}`)[0].status, "completed");
      assert.equal((await store.enqueueDue(new Date("2026-09-06T12:16:00Z"))).length, 0);
      await reset();
    });
    for (const kind of ["task", "check"] as const) for (const change of ["edited", "cancelled", "failed"] as const) {
      await t.test(`completion report cannot override a ${change} ${kind}`, async () => {
        const runId = await newRun();
        const recurring = { ...definition, kind, notifyPolicy: kind === "task" ? "always" as const : "when_relevant" as const, recurrence: { type: "interval" as const, minutes: 15 } };
        const saved = await store.create("owner@example.com", runId, recurring, "stale", now);
        const [pending] = await store.enqueueDue(due); await store.prepare(String(pending.id), due);
        const check = { completed: true, notify: true, observation: "Game final", summary: "Finished checking." };
        await sql`update agent_runs set status=${change === "failed" ? "failed" : "done"},error=${change === "failed" ? "Source failed" : null},metadata=metadata || ${sql.json({ scheduledCheckResult: check })} where id=${runId}`;
        if (change === "edited") await store.update("owner@example.com", saved.id, { definition: { ...recurring, firstRunAt: "2026-09-06T14:00:00Z", instructions: "Check another game" } }, due);
        if (change === "cancelled") await store.update("owner@example.com", saved.id, { status: "cancelled" }, due);
        const finished = await store.finish(runId, due);
        assert.equal(finished.notified, change === "failed");
        const [state] = await store.list("owner@example.com");
        assert.equal(state.status, change === "cancelled" ? "cancelled" : "active");
        assert.equal(state.nextRunAt, change === "cancelled" ? null : change === "edited" ? "2026-09-06T14:00:00.000Z" : "2026-09-06T12:16:00.000Z");
        await reset();
      });
    }
    await t.test("a meaningful check change notifies and records the last notified state",async()=>{
      const runId=await newRun();await store.create("owner@example.com",runId,{...definition,kind:"check",notifyPolicy:"when_relevant"},"changed",now);
      const [pending]=await store.enqueueDue(due);await store.prepare(String(pending.id),due);
      const check={notify:true,observation:"Price dropped to $150",summary:"The price dropped to $150."};
      await sql`update agent_runs set status='done',response=${check.summary},metadata=metadata || ${sql.json({scheduledCheckResult:check})} where id=${runId}`;
      assert.equal((await store.finish(runId,due)).notified,true);assert.equal((await store.list("owner@example.com"))[0].lastNotifiedObservation,check.observation);await reset();
    });
    await t.test("missing check reports fail visibly instead of pretending nothing changed",async()=>{
      const runId=await newRun();await store.create("owner@example.com",runId,{...definition,kind:"check",notifyPolicy:"when_relevant"},"failed",now);
      const [pending]=await store.enqueueDue(due);await store.prepare(String(pending.id),due);
      await sql`update agent_runs set status='done' where id=${runId}`;
      assert.equal((await store.finish(runId,due)).notified,true);
      assert.equal((await sql`select status from scheduled_occurrences`)[0].status,"failed");
      assert.match((await sql`select body from push_notification_jobs`)[0].body,/couldn’t complete/);await reset();
    });
    await t.test("untrusted run metadata cannot finish another conversation's occurrence",async()=>{
      const victim=await newRun();await store.create("owner@example.com",victim,{...definition,kind:"task"},"victim",now);
      const [pending]=await store.enqueueDue(due);await store.prepare(String(pending.id),due);
      const [original]=await sql`select metadata from agent_runs where id=${victim}`;
      const attacker=await newRun();await sql`update agent_runs set metadata=${sql.json(original.metadata)},response='forged' where id=${attacker}`;
      await store.finish(attacker,due);await store.abandonForUserReply(attacker,true,due);
      assert.equal((await sql`select status from scheduled_occurrences where id=${pending.id}`)[0].status,"dispatched");
      assert.equal(Number((await sql`select count(*) from push_notification_jobs`)[0].count),0);
      await reset();
    });
    await t.test("stop during an active check becomes a user turn that can cancel future occurrences", async () => {
      const runId = await newRun();
      const saved = await store.create("owner@example.com", runId, { ...definition, kind: "check", recurrence: { type: "interval", minutes: 15 } }, "active-stop", now);
      const [pending] = await store.enqueueDue(due); await store.prepare(String(pending.id), due);
      const runs = new PostgresRunStore(databaseUrl!, sql);
      await runs.updateRun(runId, { status: "running" });
      await runs.enqueueSteering(runId, { role: "user", content: "Stop checking" });
      assert.equal(await consumeUserSteering(runs, runId, id => store.abandonForUserReply(id, false, due)), true);
      assert.equal((await runs.getRun(runId))!.metadata.scheduleExecution, undefined);
      assert.equal((await runs.listMessages(runId)).at(-1)?.message.content, "Stop checking");
      await store.update("owner@example.com", saved.id, { status: "cancelled" }, due);
      assert.equal((await store.enqueueDue(new Date("2026-09-06T12:16:00Z"))).length, 0);
      await reset();
    });
    await t.test("user replies can take over a paused check and modify its schedule",async()=>{
      const runId=await newRun();const saved=await store.create("owner@example.com",runId,{...definition,kind:"check",notifyPolicy:"when_relevant",recurrence:{type:"interval",minutes:60}},"stop",now);
      const [pending]=await store.enqueueDue(due);await store.prepare(String(pending.id),due);
      await sql`update agent_runs set status='paused' where id=${runId}`;
      await store.abandonForUserReply(runId,false,due);
      assert.equal((await sql`select metadata from agent_runs where id=${runId}`)[0].metadata.scheduleExecution,undefined);
      assert.equal((await store.update("owner@example.com",saved.id,{status:"cancelled"},due)).status,"cancelled");await reset();
    });
  }finally{await sql.end();await admin.unsafe(`drop schema ${schema} cascade`);await admin.end()}
});
