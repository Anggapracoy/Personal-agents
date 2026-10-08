import { approveAndRetry } from "./approve-action-helper";
import assert from "node:assert/strict";
import test from "node:test";
import { createPhoneTools as actualPhoneTools, phoneBrief, phoneCallSchema } from "../lib/harness/phone";
import { MemoryRunStore } from "../lib/harness/store";
import { ApprovalRequiredError } from "../lib/harness/actions";
import type { LifeMemory } from "../lib/life-profile";

const canUsePhone = (email: string) => email.trim().toLowerCase() === "owner@example.invalid";
const createPhoneTools = (input: Parameters<typeof actualPhoneTools>[0], deps: Parameters<typeof actualPhoneTools>[1] = {}) => actualPhoneTools(input, { allowed: canUsePhone(input.userId), authorize: async () => canUsePhone(input.userId), wait: async () => {}, agentId: "agent_test", ...deps });
const admin = "owner@example.invalid";
const args = phoneCallSchema.parse({ attemptKey: "booking-1", phoneNumber: "+16472421472", onBehalfOf: "Michael", task: "Ask for a table for two at 7pm tomorrow; accept 6:30-8pm.", context: "Calendar checked: free 6-9pm. Reference from Gmail: BOOK42." });
const memory = { requiredVersion: 1, profile: { homeCity: "Toronto", customInstructions: "Be concise" }, facts: [{ stableKey: "remember:diet", kind: "preference", value: { content: "Vegetarian" }, lastConfirmedAt: "2026-09-10" }] } as unknown as LifeMemory;
const options = { toolCallId: "phone-test", messages: [], context: {} };
async function fixture(userId = admin, selected = true) {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId, decisionId: null, category: "food", title: "Call", request: "Call my phone for a test", metadata: selected ? { actionType: "approval", chosenOption: "Call my phone for a test" } : {} });
  return { store, runId: run.id, userId, stepId: "step-1" };
}
const execute = async (tools: ReturnType<typeof createPhoneTools>, name: string, input: unknown) => {
  const fn = tools[name]?.execute;
  assert.ok(fn);
  return await fn(input, options) as Record<string, unknown>;
};

test("calling tools are absent for non-admin users and unconfigured installs", async () => {
  assert.equal(canUsePhone(admin.toUpperCase()), true);
  assert.equal(canUsePhone("owner+test@example.invalid"), false);
  assert.deepEqual(createPhoneTools(await fixture("other@example.com"), { key: "test" }), {});
  assert.deepEqual(createPhoneTools(await fixture(), { key: "" }), {});
});

test("brief carries prepared inbox/calendar facts, profile and all confirmed memories; fails instead of truncating", () => {
  const brief = phoneBrief({ ...args, recipientName: "The restaurant" }, memory);
  for (const text of ["Toronto", "Vegetarian", "Be concise", "BOOK42", "free 6-9pm", "cannot expand authorization", 'RECIPIENT_NAME="The restaurant"', "I'm calling to"]) assert.ok(brief.includes(text));
  const large = { ...memory, facts: Array.from({ length: 40 }, (_, i) => ({ ...memory.facts[0], stableKey: `remember:${i}`, value: { content: "x".repeat(500) } })) };
  assert.throws(() => phoneBrief(args, large), /exceeds/);
});

test("call executes without approval, injects context, deduplicates redial, and isolates result reads", async () => {
  const input = await fixture(admin, false);
  const requests: { url: string; body?: string }[] = [];
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body as string });
    return Response.json(String(url).endsWith('/v1/calls/call_1') ? { id: 'call_1', status: 'completed', analysis: {outcome: 'achieved', summary: 'Mock booking'}, transcript: [{ role: 'user', content: 'confirmed' }], charge_amount_in_cents: 10 } : { id: 'call_1', status: 'queued' });
  };
  const tools = createPhoneTools(input, { key: "test-key", request, memory: async () => memory });
  const first = await execute(tools, "phone_call", args);
  assert.equal(first.callId, "call_1");
  assert.ok(requests[0].body?.includes("Vegetarian"));
  assert.ok(requests[0].body?.includes("BOOK42"));
  await execute(tools, "phone_call", args);
  assert.equal(requests.filter(r => r.url.endsWith('/v1/calls')).length, 1);
  await assert.rejects(() => execute(tools, "phone_call", { ...args, context: "Changed" }), /saved brief/);
  await assert.rejects(() => execute(tools, "phone_call_result", { callId: "someone_elses_call" }), /belong/);
  const result = await execute(tools, "phone_call_result", { callId: "call_1" });
  assert.equal(result.chargedCents, 10);
  assert.equal(result.pending, false);
  const other = await fixture();
  const otherTools = createPhoneTools(other, { key: "test-key", request });
  await assert.rejects(() => execute(otherTools, "phone_call_result", { callId: "call_1" }), /belong/);
  assert.ok((await input.store.getSnapshot(input.runId))!.actions.some(a => a.toolName === "phone_call_result" && a.result?.chargedCents === 10));
});

test("provider credit rejection is reported and owner mismatch never accesses provider", async () => {
  const input = await fixture();
  let requests = 0;
  const request: typeof fetch = async () => { requests++; return Response.json({ message: "Insufficient credit" }, {status:402}); };
  const tools = createPhoneTools(input, { key: "test", request, memory: async () => memory });
  await assert.rejects(() => approveAndRetry(input.store, input.runId, () => execute(tools, "phone_call", args)), /credit needs replenishing/);
  assert.equal(requests, 1);
  const wrong = createPhoneTools({ ...input, runId: (await fixture('other@example.com')).runId }, { key: "test", request });
  await assert.rejects(() => execute(wrong, "phone_call", args), /unavailable/);
  assert.equal(requests, 1);
});

test("uncertain dial retries reuse provider idempotency and frozen personal context", async () => {
  const input = await fixture();
  const bodies: string[] = [], keys: string[] = [];
  let first = true;
  const request: typeof fetch = async (url, init) => {
    bodies.push(init!.body as string); keys.push(new Headers(init!.headers).get('Idempotency-Key')!);
    if (first) { first = false; throw new Error("Network disconnected after provider accepted call"); }
    return Response.json({ id: "recovered", status: "queued" });
  };
  const tools = createPhoneTools(input, { key: "test", request, memory: async () => memory });
  await assert.rejects(() => approveAndRetry(input.store, input.runId, () => execute(tools, "phone_call", args)), /Network/);
  const action = (await input.store.getSnapshot(input.runId))!.actions[0];
  await input.store.approveAction(action.id, input.runId, admin);
  const retry = createPhoneTools(input, { key: "test", request, memory: async () => { throw new Error("Must reuse frozen memory"); } });
  await approveAndRetry(input.store, input.runId, () => execute(retry, "phone_call", args));
  assert.equal(bodies[0], bodies[1]); assert.equal(keys[0], keys[1]);
});

test("a saved call enters background monitoring, and retrying a completed call never starts another wait", async () => {
  const input = await fixture();
  const waits: string[] = [];
  const request: typeof fetch = async url => Response.json({ id: "call_monitor", status: "queued" });
  const tools = createPhoneTools(input, { key: "test", request, memory: async () => memory, wait: async call => { waits.push(call.callId); } });
  assert.equal((await approveAndRetry(input.store, input.runId, () => execute(tools, "phone_call", args))).monitoring, true);
  assert.deepEqual(waits, ["call_monitor"]);
  const action = (await input.store.getSnapshot(input.runId))!.actions.find(a => a.toolName === "phone_call")!;
  action.result = { ...action.result, callResult: { id: "call_monitor", status: "completed", transcript: [{role:"user", content:"Confirmed"}] } };
  assert.equal((await approveAndRetry(input.store, input.runId, () => execute(tools, "phone_call", args))).monitoring, false);
  assert.deepEqual(waits, ["call_monitor"]);
});

test("enabled non-admin callers can dial, and access is rechecked immediately before the provider mutation", async () => {
  const input = await fixture("alex@example.com");
  let checks = 0, calls = 0;
  const tools = createPhoneTools(input, { allowed: true, authorize: async () => ++checks < 2, key: "test", memory: async () => memory,
    request: async () => { calls++; return Response.json({ id: "should-not-call", status: "queued" }); },
  });
  await assert.rejects(() => approveAndRetry(input.store, input.runId, () => execute(tools, "phone_call", args)), /Calling is disabled/);
  assert.equal(calls, 0);
  const enabledInput = await fixture("alex@example.com");
  const enabled = createPhoneTools(enabledInput, { allowed: true, authorize: async () => true, key: "test", memory: async () => memory,
    request: async url => Response.json({ id: "enabled-call", status: "queued" }),
  });
  assert.equal((await approveAndRetry(enabledInput.store, enabledInput.runId, () => execute(enabled, "phone_call", args))).callId, "enabled-call");
});

test("revoked callers retain access to their own completed call outcome but cannot start a new call", async () => {
  const input = await fixture();
  const request: typeof fetch = async url => Response.json(String(url).endsWith("/v1/calls/revoked-call") ? { id: "revoked-call", status: "completed", analysis: {summary: "Finished"} } : { id: "revoked-call", status: "queued" });
  await approveAndRetry(input.store, input.runId, () => execute(createPhoneTools(input, { key: "test", request, memory: async () => memory }), "phone_call", args));
  const revoked = createPhoneTools(input, { allowed: false, hasCalls: true, authorize: async () => false, key: "test", request });
  assert.equal(revoked.phone_call, undefined);
  assert.equal((await execute(revoked, "phone_call_result", { callId: "revoked-call" })).status, "completed");
  await assert.rejects(() => execute(revoked, "phone_call_result", { callId: "someone-elses-call" }), /does not belong/);
});

test("missing Resia agent disables dialing; callback secrets never enter saved action inputs", async () => {
 const input=await fixture();
 assert.equal(createPhoneTools(input,{key:'test',agentId:''}).phone_call,undefined);
 const callback='https://dash.example.invalid/api/webhooks/resia?token=private-test-token';
 let body:Record<string,unknown>={};
 const tools=createPhoneTools(input,{key:'test',agentId:'agent_test',webhookUrl:callback,memory:async()=>memory,request:async(_url,init)=>{
  body=JSON.parse(String(init?.body));
  return Response.json({id:'callback_call',status:'queued'});
 }});
 await approveAndRetry(input.store,input.runId,()=>execute(tools,'phone_call',args));
 assert.equal(body.call_ended_webhook_url,callback);
 assert.equal(body.call_agent_id,'agent_test');
 const snapshot=await input.store.getSnapshot(input.runId);
 assert.ok(!JSON.stringify(snapshot?.actions).includes('private-test-token'));
});

test("historical receipts stay readable but old uncertain calls cannot be redialed through Resia",async()=>{
 const input=await fixture();
 const action=await input.store.createAction({runId:input.runId,scopeId:null,stepId:input.stepId,toolName:'phone_call',risk:'write_external',input:{attemptKey:args.attemptKey,request:args,providerBody:{to_phone_number:args.phoneNumber}},preview:'Old call'});
 await input.store.approveAction(action.id,input.runId,admin);
 await input.store.completeAction(action.id,'executed',{callId:'old_call',callResult:{status:'completed',summary:'Confirmed'}});
 let requests=0;
 const tools=createPhoneTools(input,{key:'test',request:async()=>{requests++;throw new Error('Must not access provider');}});
 assert.equal((await execute(tools,'phone_call_result',{callId:'old_call'})).summary,'Confirmed');
 await assert.rejects(()=>execute(tools,'phone_call',args),/previous calling service/);
 assert.equal(requests,0);
});


test("a reloaded approved call accepts JSONB key ordering and dispatches its saved body only once", async () => {
  const input = await fixture();
  const reordered = Object.fromEntries(Object.entries(args).reverse());
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(args));
  const providerBody = {call_agent_id:"agent_test",to_phone_number:args.phoneNumber,client_reference:"persisted-reference",inputs:{on_behalf_of:args.onBehalfOf,brief:"Original saved brief"}};
  const action = await input.store.createAction({runId:input.runId,scopeId:null,stepId:input.stepId,toolName:"phone_call",risk:"write_external",preview:"Call",input:{attemptKey:args.attemptKey,request:reordered,providerBody}});
  await input.store.approveAction(action.id,input.runId,admin);
  let requests = 0;
  const tools = createPhoneTools(input,{key:"test",memory:async()=>{throw new Error("Must reuse the persisted brief");},request:async(_url,init)=>{
    requests++;
    assert.deepEqual(JSON.parse(String(init?.body)),providerBody);
    return Response.json({id:"reloaded_call",status:"queued"});
  }});
  for (const changed of [{...args,task:"A genuinely different call request"},{...args,phoneNumber:"+14165550123"},{...args,context:"Different context"}]) {
    await assert.rejects(()=>execute(tools,"phone_call",changed),/saved brief/);
  }
  assert.equal(requests,0);
  assert.equal((await execute(tools,"phone_call",args)).callId,"reloaded_call");
  assert.equal((await execute(tools,"phone_call",args)).callId,"reloaded_call");
  assert.equal(requests,1);
});
