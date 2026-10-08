import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { easterEggTool, easterEggInstructions } from "../lib/harness/easteregg";
import { threadItems } from "../lib/harness/thread";

test("confetti is tool-only, current-message scoped, retry-safe and repeatable", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "confetti@example.invalid", decisionId: null, category: "social", title: "Confetti", request: "confetti", metadata: {} });
  await store.appendMessages(run.id, [{ role: "user", content: "confetti" }]);
  const latest = async () => threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id)).filter(x => x.kind === "user").at(-1)!.id;
  const execute = easterEggTool(store, run.id).execute!;
  const options = { toolCallId: "test", messages: [], context: {} };
  assert.equal((await execute({ messageId: "wrong", effect: "confetti", trigger: "user_request" }, options) as any).queued, false);
  assert.equal((await store.getRun(run.id))!.metadata.easterEggEvent, undefined);
  const id = await latest();
  const first = await execute({ messageId: id, effect: "confetti", trigger: "user_request" }, options) as any;
  const retry = await execute({ messageId: id, effect: "confetti", trigger: "user_request" }, options) as any;
  assert.equal(first.queued, true); assert.equal(retry.eventId, first.eventId);
  await store.appendMessages(run.id, [{ role: "user", content: "again" }]);
  assert.equal((await execute({ messageId: id, effect: "confetti", trigger: "user_request" }, options) as any).queued, false);
  const repeat = await execute({ messageId: await latest(), effect: "confetti", trigger: "user_request" }, options) as any;
  assert.notEqual(repeat.eventId, first.eventId);
});

test("excited-user bursts are rate limited but explicit requests still work", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "excited@example.invalid", decisionId: null, category: "social", title: "Yay", request: "yay", metadata: {} });
  const execute = easterEggTool(store, run.id).execute!;
  const fire = async (trigger: "user_request" | "user_excitement") => {
    await store.appendMessages(run.id, [{ role: "user", content: "yay so happy" }]);
    const id = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id)).filter(x => x.kind === "user").at(-1)!.id;
    return await execute({ messageId: id, effect: "confetti", trigger }, { toolCallId: "test", messages: [], context: {} }) as any;
  };
  assert.equal((await fire("user_excitement")).queued, true);
  assert.equal((await fire("user_excitement")).queued, false);
  assert.equal((await fire("user_request")).queued, true);
  assert.match(easterEggInstructions, /Ordinary thanks or praise/);
  assert.match(easterEggInstructions, /Never fire it from task completion/);
});

test('one easteregg tool queues all five effects and requires requests for new ones', async () => {
 const store=new MemoryRunStore(); const run=await store.createRun({userId:'effects@example.invalid',decisionId:null,category:'social',title:'Effects',request:'effects',metadata:{}});
 const execute=easterEggTool(store,run.id).execute!;
 for(const effect of ['confetti','disco','snow','flip','67'] as const){
  await store.appendMessages(run.id,[{role:'user',content:`Please play ${effect}`}]);
  const id=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id)).filter(x=>x.kind==='user').at(-1)!.id;
  if(effect!=='confetti')assert.equal((await execute({messageId:id,effect,trigger:'user_excitement'},{toolCallId:'test',messages:[],context:{}}) as any).queued,false);
  const receipt=await execute({messageId:id,effect,trigger:'user_request'},{toolCallId:'test',messages:[],context:{}}) as any;
  assert.equal(receipt.queued,true); assert.equal(((await store.getRun(run.id))!.metadata.easterEggEvent as any).effect,effect);
 }
});
