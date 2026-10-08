import assert from "node:assert/strict";
import test from "node:test";
import { parseResiaCall, phoneCallTerminal, resiaCallEvidence, resiaAgentConfiguration, RESIA_CALL_POLICY } from "../lib/harness/resia";
import { checkPhoneCall } from "../lib/harness/phone-monitor";
import { handleResiaWebhook } from "../lib/harness/resia-webhook";
import type { PauseStore } from "../lib/pauses/store";

const webhookUrl = `https://dash.example.invalid/api/webhooks/resia?token=${'a'.repeat(48)}`;
const request = (url = webhookUrl, body: unknown = {type:"call.ended", call:{id:"call_1",status:"completed",analysis:{summary:"Untrusted"}}}) => new Request(url, {method:"POST",body:JSON.stringify(body)});

test("all Resia lifecycle states are understood; processing and unknown never imply completion",()=>{
 for (const status of ['queued','initiated','in_progress','post_processing','unknown']) {
  const call=parseResiaCall({id:'call_1',status},'call_1');
  assert.equal(resiaCallEvidence(call).pending,true);
 }
 for (const status of ['completed','error','canceled']) assert.equal(phoneCallTerminal(status),true);
 assert.throws(()=>parseResiaCall({id:'other',status:'completed'},'call_1'),/different call/);
 assert.throws(()=>parseResiaCall({id:'call_1',status:'made_up'}));
 assert.deepEqual(resiaAgentConfiguration.input_schema.required,['on_behalf_of','brief']);
 const evidence=resiaCallEvidence({id:'call_1',status:'completed',analysis:{outcome:'not_achieved',summary:'Nobody answered'},charge_amount_in_cents:12});
 assert.equal(evidence.outcome,'not_achieved');assert.equal(evidence.chargedCents,12);
});

test("the call agent introduces Dash and speaks in first person without impersonating the user",()=>{
 assert.match(RESIA_CALL_POLICY,/Dash, an AI assistant calling on behalf of \[name\]/);
 assert.match(RESIA_CALL_POLICY,/I'm calling to/);
 assert.match(RESIA_CALL_POLICY,/use first person for every substantive request, question, proposal, and follow-up/);
 assert.match(RESIA_CALL_POLICY,/I want to/);
 assert.match(RESIA_CALL_POLICY,/Do not switch back to third-person phrasing/);
 assert.match(RESIA_CALL_POLICY,/I'd like to/);
 assert.match(RESIA_CALL_POLICY,/Never claim to be the user/);
 assert.ok(resiaAgentConfiguration.instructions.includes(RESIA_CALL_POLICY));
});

test("monitor saves processing/unknown evidence and resumes only on terminal status",async()=>{
 const saved: Record<string,unknown>[]=[];
 let status='post_processing', failures=0;
 const store={phoneCalls:async()=>[{id:'pause_1',runId:'run_1',definition:{condition:{type:'phone_call',callId:'call_1'}}}], resetCheckFailures:async()=>{},savePhoneProgress:async(_:string,result:Record<string,unknown>)=>{saved.push(result);return phoneCallTerminal(result.status);},recordCheckFailure:async()=>++failures} as unknown as PauseStore;
 const fetcher:typeof fetch=async url=>{
  assert.equal(String(url),'https://api.resia.ai/v1/calls/call_1');
  return Response.json({id:'call_1',status});
 };
 for (const value of ['initiated','post_processing','unknown','canceled']) {
  status=value;
  assert.equal((await checkPhoneCall('pause_1',{store,key:'test',request:fetcher})).state,value==='canceled'?'ready':'pending');
 }
 assert.equal(saved.length,4);assert.equal(failures,0);
});

test("call evidence preserves playback diagnostics without inventing a disconnect cause",()=>{
 const transcript = [
  {role:'assistant',content:'A complete generated sentence.',spoken_text:'A complete',interrupted:true,cut_cause:'barge-in',start_secs:2,end_secs:3},
  {role:'assistant',content:'Another sentence.',spoken_text:'Another',interrupted:true,cut_cause:'call-ended',start_secs:4,end_secs:5},
  {role:'assistant',content:'Unknown cutoff.',spoken_text:'Unknown',interrupted:true,cut_cause:null},
 ];
 const recording={available:true,started_at:'2026-09-27T00:37:00Z',duration_secs:5,format:'wav'};
 const evidence=resiaCallEvidence(parseResiaCall({id:'call_1',status:'completed',call_agent_version_id:'version_1',duration_secs:5.8,recording,stt_stream_started_at:'2026-09-27T00:37:00Z',failure:null,transcript}));
 assert.deepEqual(evidence.transcript,transcript);
 assert.deepEqual(evidence.recording,recording);
 assert.equal(evidence.callAgentVersionId,'version_1');
 assert.equal(evidence.durationSeconds,5.8);
 assert.equal(evidence.failure,null);
 assert.equal(evidence.outcome,undefined);
 const historical=resiaCallEvidence({id:'old',status:'completed'});
 assert.equal(historical.recording,undefined);
 assert.equal(historical.durationSeconds,undefined);
 assert.equal(historical.pending,false);
});

test("webhooks reject invalid tokens before lookup and re-read provider evidence instead of trusting payload",async()=>{
 let lookups=0,checks=0,resumes=0;
 const deps={webhookUrl,find:async()=>{lookups++;return [{id:'pause_1',runId:'run_1'}];},check:async()=>{checks++;return {state:'pending' as const,runId:'run_1'};},resume:async()=>{resumes++;}};
 assert.equal((await handleResiaWebhook(request('https://dash.example.invalid/api/webhooks/resia?token=bad'),deps)).status,401);
 assert.equal(lookups,0);
 assert.equal((await handleResiaWebhook(request(),deps)).status,204);
 assert.equal(checks,1);assert.equal(resumes,0);
 assert.equal((await handleResiaWebhook(request(),{...deps,check:async()=>({state:'ready' as const,runId:'run_1'})})).status,204);
 assert.equal(resumes,1);
 assert.equal((await handleResiaWebhook(request(),{...deps,find:async()=>[]})).status,204);
 assert.equal(resumes,1);
 assert.equal((await handleResiaWebhook(request(webhookUrl,{type:'other'}),deps)).status,400);
});
