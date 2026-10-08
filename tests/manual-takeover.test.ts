import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryRunStore} from '../lib/harness/store';
import {runAgent} from '../lib/harness/run';
const create=async()=>{const store=new MemoryRunStore();const run=await store.createRun({userId:'takeover@test.invalid',decisionId:null,title:'Browser',request:'Fill the form',category:'test',metadata:{}},()=>[{role:'user',content:'Fill the form'}]);return{store,run}};
test('manual takeover atomically pauses, is idempotent, and rejects other owners or pending approvals',async()=>{
 const{store,run}=await create();assert.equal(await store.beginManualTakeover(run.id,'other'),null);
 const [a,b]=await Promise.all([store.beginManualTakeover(run.id,run.userId,'https://example.com'),store.beginManualTakeover(run.id,run.userId)]);
 assert.ok(a);assert.equal(a.id,b?.id);assert.equal((await store.getRun(run.id))?.status,'awaiting_approval');assert.equal(await store.finishRunIfNoSteering(run.id,null),false);
 assert.equal((await store.getSnapshot(run.id))?.actions.length,1);
 const other=await create();await other.store.createAction({runId:other.run.id,stepId:null,toolName:'purchase',risk:'write_external',preview:'Review',input:{}});
 assert.equal(await other.store.beginManualTakeover(other.run.id,other.run.userId),null);
});
test('takeover aborts a reasoning model without a tool call, preserving the pending handoff',async()=>{
 const{store,run}=await create();let started!:()=>void;const ready=new Promise<void>(r=>started=r);let aborted=false;
 const task=runAgent({runId:run.id,store,model:{async turn({signal,onNarration}){started();await new Promise<void>(r=>signal!.addEventListener('abort',()=>{aborted=true;r()},{once:true}));await assert.rejects(onNarration('Should never appear'));}}});
 await ready;await store.beginManualTakeover(run.id,run.userId);await task;
 assert.equal(aborted,true);assert.equal((await store.getRun(run.id))?.status,'awaiting_approval');assert.equal((await store.getRun(run.id))?.response,'');
});
test('a quick Continue cannot let the interrupted worker finalize the resumed run',async()=>{
 const{store,run}=await create();let started!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
 const task=runAgent({runId:run.id,store,model:{async turn({onNarration}){started();await gate;await onNarration('stale');}}});
 await ready;const action=await store.beginManualTakeover(run.id,run.userId);await store.approveAction(action!.id,run.id,run.userId);await store.completeAction(action!.id,'executed',{resumedAfterTakeover:true});await store.updateRun(run.id,{status:'running'});release();await task;
 assert.equal((await store.getRun(run.id))?.status,'running');assert.equal((await store.getRun(run.id))?.response,'');
 await runAgent({runId:run.id,store,model:{async turn({onNarration}){await onNarration('Resumed');}}});assert.equal((await store.getRun(run.id))?.status,'done');
});

test('a running read tool does not masquerade as a pending user approval',async()=>{
 const{store,run}=await create();
 await store.createAction({runId:run.id,stepId:null,toolName:'browser_inspect',risk:'read',preview:'Inspecting',input:{}});
 const takeover=await store.beginManualTakeover(run.id,run.userId);assert.ok(takeover);
 assert.equal((await store.getRun(run.id))?.status,'awaiting_approval');
});
