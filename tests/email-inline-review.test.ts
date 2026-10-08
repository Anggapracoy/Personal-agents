import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryRunStore} from '../lib/harness/store';
import {isApprovalRequired} from '../lib/harness/actions';
import {createGoogleToolRegistry} from '../lib/harness/google-tools';

test('the actual Gmail tool presents draft review without sending and preserves approved continuation',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'inline-test@example.invalid',decisionId:null,category:'email',title:'Draft',request:'Show a draft inline',metadata:{}});
 await store.updateRun(run.id,{status:'running'});await store.putSecret(run.id,'google_access_token','fake-local-token');
 const registry=await createGoogleToolRegistry({runId:run.id,userId:run.userId,stepId:'review',store});
 const input={draftId:'fake-draft',to:['recipient@example.invalid'],subject:'Demo',body:'Hi there.'};
 let sends=0;const previous=globalThis.fetch;
 globalThis.fetch=(async()=>{sends++;return new Response(JSON.stringify({id:'sent-message'}),{status:200,headers:{'Content-Type':'application/json'}});}) as typeof fetch;
 try{
  await assert.rejects(()=>registry.tools.gmail_send_draft.execute!(input,{toolCallId:'review-call',messages:[]} as any) as Promise<unknown>,isApprovalRequired);
  assert.equal(sends,0);
  const snapshot=await store.getSnapshot(run.id);const action=snapshot!.actions.find(a=>a.toolName==='gmail_send_draft')!;
  assert.equal(action.input.draftId,'fake-draft');assert.match(action.preview,/Hi there/);
  await store.approveAction(action.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});
  await registry.tools.gmail_send_draft.execute!(input,{toolCallId:'approved-call',messages:[]} as any);
  assert.equal(sends,1);
 }finally{globalThis.fetch=previous;}
});
