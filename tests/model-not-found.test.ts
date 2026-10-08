import assert from "node:assert/strict";
import test from "node:test";
import { isTemporaryMetaModelNotFound } from "../lib/harness/model-not-found";
import { MemoryRunStore } from "../lib/harness/store";
import { runAgent } from "../lib/harness/run";
import { appendConversationReply } from "../lib/harness/conversation-reply";

const missing = () => Object.assign(new Error("The requested model was not found."), {
  url: "https://api.meta.ai/v1/chat/completions", statusCode: 404, isRetryable: false,
  responseBody: '{"error":{"code":"model_not_found"}}',
});

test("only Meta's exact model-not-found response gets the short retry", () => {
  assert.equal(isTemporaryMetaModelNotFound(missing()), true);
  assert.equal(isTemporaryMetaModelNotFound({ lastError: missing() }), true);
  for (const override of [{ url: "https://api.openai.com/v1/responses" }, { statusCode: 401 }, { responseBody: '{"error":{"code":"invalid_api_key"}}' }, { responseBody: "not JSON" }]) {
    assert.equal(isTemporaryMetaModelNotFound({ ...missing(), ...override }), false);
  }
  assert.equal(isTemporaryMetaModelNotFound(new Error("The requested model was not found.")), false);
});

test("model-not-found waits one second and resumes without losing the opening or tool receipts", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:"retry@test",decisionId:null,category:"food",title:"Dinner",request:"Find dinner",metadata:{}});
  await store.appendMessages(run.id, [{role:"user",content:"Find dinner"},{role:"assistant",content:"I'll check."}]);
  await store.putSecret(run.id,"test","retained");
  const action = await store.createAction({runId:run.id,stepId:null,toolName:"calendar_get_event",input:{eventId:"saved"},preview:"Read event",risk:"read"});
  await store.completeAction(action.id,"executed",{time:"18:00"});
  let calls = 0;
  const model = { async turn({onNarration}: {onNarration:(text:string)=>Promise<void>}) {
    if (++calls === 1) throw missing();
    await onNarration("Found dinner.");
  } };
  assert.equal((await runAgent({runId:run.id,store,model}))?.retryAfterMs, 1_000);
  assert.equal((await store.getRun(run.id))?.status,"running");
  assert.equal(await store.getSecret(run.id,"test"),"retained");
  await runAgent({runId:run.id,store,model});
  assert.equal(calls,1,"an early dispatch must not retry immediately");
  await store.updateRunMetadata(run.id,{modelRetryAt:Date.now()-1});
  await runAgent({runId:run.id,store,model});
  assert.equal((await store.getRun(run.id))?.status,"done");
  assert.equal((await store.getRun(run.id))?.metadata.modelNotFoundRetries,0);
  assert.equal((await store.listMessages(run.id)).length,2);
  assert.equal((await store.getAction(action.id,run.id))?.status,"executed");
});

test("persistent missing models stop after three retries; Try again resumes a manual chat with no options", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:"retry@test",decisionId:null,category:"food",title:"Dinner",request:"Find dinner",metadata:{retryDecision:{options:[]}}});
  await store.appendMessages(run.id,[{role:"user",content:"Find dinner"}]);
  const model = {async turn(){throw missing();}};
  for (let attempt=0;attempt<3;attempt++) {
    assert.equal((await runAgent({runId:run.id,store,model}))?.retryAfterMs,1_000);
    await store.updateRunMetadata(run.id,{modelRetryAt:Date.now()-1});
  }
  await runAgent({runId:run.id,store,model});
  assert.equal((await store.getRun(run.id))?.status,"failed");
  await appendConversationReply(store,run.id,"Try again.");
  assert.equal((await store.getRun(run.id))?.status,"running");
  assert.equal((await store.getRun(run.id))?.metadata.modelNotFoundRetries,0);
  assert.deepEqual((await store.listMessages(run.id)).map(m=>m.message.content),["Find dinner","Try again."]);
  assert.equal((await runAgent({runId:run.id,store,model}))?.retryAfterMs,1_000);
  await store.updateRun(run.id,{status:"cancelled"});
  let invoked=false;
  await runAgent({runId:run.id,store,model:{async turn(){invoked=true;}}});
  assert.equal(invoked,false);
});
