import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryRunStore} from '../lib/harness/store';
import {executeGuardedAction,ApprovalRequiredError} from '../lib/harness/actions';
for(const approvalType of ['bill_payment','transfer','payment'])test(`${approvalType} pauses for explicit review even when a purchase preference exists`,async()=>{
 const store=new MemoryRunStore();const run=await store.createRun({userId:'test',decisionId:null,category:'money',title:'Payment',request:'Pay the invoice',metadata:{}});await store.updateRun(run.id,{status:'running'});let dispatched=0;
 const act=()=>executeGuardedAction({runId:run.id,toolName:'browser_click',risk:'write_external',preview:'Review payment',args:{ref:'pay',requiresApproval:true,approvalType},alwaysApproved:true,store,execute:async()=>{dispatched++;return{ok:true}}});
 await assert.rejects(act(),ApprovalRequiredError);assert.equal(dispatched,0);
 const snapshot=(await store.getSnapshot(run.id))!;assert.equal(snapshot.status,'awaiting_approval');assert.equal(snapshot.actions[0].approvedAt,null);
 await store.approveAction(snapshot.actions[0].id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});await act();assert.equal(dispatched,1);
});
