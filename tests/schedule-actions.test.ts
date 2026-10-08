import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { executeGuardedAction } from "../lib/harness/actions";
import { appendConversationReply } from "../lib/harness/conversation-reply";

test("scheduled action receipts dedupe retries but do not swallow the next occurrence",async()=>{
  const store=new MemoryRunStore();
  const run=await store.createRun({userId:"schedule-test@example.com",decisionId:null,category:"social",request:"Repeat this",title:"Repeat",metadata:{actionScopeId:"occurrence-one"}});
  await store.updateRun(run.id,{status:"running"});
  let executed=0;
  const act=(stepId:string)=>executeGuardedAction({runId:run.id,stepId,toolName:"test_write",risk:"write_reversible",preview:"Do the task",args:{value:1},store,dedupeAcrossSteps:true,execute:async()=>({execution:++executed})});
  await act("first"); assert.equal(executed,1);
  await act("retry"); assert.equal(executed,1);
  await store.updateRunMetadata(run.id,{actionScopeId:"occurrence-two"});
  await act("next-occurrence"); assert.equal(executed,2);
  await act("retry-next"); assert.equal(executed,2);
});

test("simultaneous replies start one worker and steer it with the other message",async()=>{
  const store=new MemoryRunStore();
  const run=await store.createRun({userId:"reply-test@example.com",decisionId:null,category:"social",request:"Help",title:"Help",metadata:{}});
  await store.updateRun(run.id,{status:"done"});
  const outcomes=await Promise.all([appendConversationReply(store,run.id,"Change it"),appendConversationReply(store,run.id,"Pause it")]);
  assert.deepEqual(outcomes.sort(), ["started", "steering"]);
  await store.consumeSteering(run.id);
  assert.deepEqual((await store.listMessages(run.id)).map(m => m.message.content), ["Change it", "Pause it"]);
});


test("completion reports support automatic tasks and checks but reject ordinary conversations", async () => {
  const { createScheduleTools } = await import("../lib/schedules/tools");
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "watch@test.invalid", decisionId: null, category: "social", request: "Watch this game", title: "Game", metadata: {} });
  const tools = createScheduleTools({ runId: run.id, userId: run.userId, stepId: "check", store });
  const report = { completed: true, notify: false, observation: "Official scoreboard says final", summary: "The game ended. I’ve stopped checking." };
  const execute = () => tools.report_check.execute!(report, { toolCallId: "report", messages: [], context: {} });
  await assert.rejects(async () => execute(), /no automatic task or check/);
  for (const kind of ["task", "check"]) {
    await store.updateRunMetadata(run.id, { scheduleExecution: { kind } });
    assert.deepEqual(await execute(), { recorded: true, notify: true, completed: true });
    assert.deepEqual((await store.getRun(run.id))!.metadata.scheduledCheckResult, { ...report, notify: true });
  }
  await store.updateRunMetadata(run.id, { scheduleExecution: { kind: "task" } });
  assert.deepEqual(await tools.report_check.execute!({ ...report, completed: false }, { toolCallId: "ongoing", messages: [], context: {} }), { recorded: true, notify: true, completed: false });
});
