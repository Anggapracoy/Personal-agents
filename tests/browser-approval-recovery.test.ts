import assert from 'node:assert/strict';
import test from 'node:test';
import { executeGuardedAction, ApprovalRequiredError } from '../lib/harness/actions';
import { browserApprovalEvidence, BrowserPreDispatchError } from '../lib/harness/browser/approval';
import { MemoryRunStore } from '../lib/harness/store';
import { checkoutDisplayTotal } from '../lib/checkout-display';

test('approval binds only the page and exact submit control', () => {
  const control = { ref:'e1',name:'Place order',role:'button',tag:'button',type:'submit',href:'',disabled:false,checked:null };
  const page = { title:'Checkout',url:'https://shop.example/checkout',documentId:'doc',text:'Total $20',elements:[control],activeModalCount:0 };
  const hash = browserApprovalEvidence(page,'e1');
  assert.equal(hash,browserApprovalEvidence({...page,text:'New banner, expanded order summary, total $21',elements:[control,{...control,ref:'e2',name:'Newsletter'}],activeModalCount:1},'e1'));
  for(const change of [{url:'https://other.example/checkout'},{url:'https://shop.example/other'},{documentId:'new'},{elements:[{...control,name:'Subscribe'}]},{elements:[{...control,href:'https://shop.example/other'}]}]) assert.notEqual(hash,browserApprovalEvidence({...page,...change},'e1'));
  assert.throws(()=>browserApprovalEvidence({...page,elements:[]},'e1'),/missing/);
});

test('same approved checkout survives explicit click-to-Enter recovery only before dispatch', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'approval@example.invalid',decisionId:null,title:'Checkout',request:'Order',category:'test',metadata:{}});
  await store.updateRun(run.id,{status:'running'});
  const args = {requiresApproval:true,ref:'e1',pageUrl:'https://example.com',pageEvidence:'same-evidence',elementName:'Place order',elementRole:'button',purpose:'Order one item for $20',approvalCategory:'purchase'};
  let attempts=0;
  const invoke=(toolName='browser_click',extra:Record<string,unknown>={},failure?:Error)=>executeGuardedAction({runId:run.id,toolName,risk:'write_external',preview:'Order',args:{...args,...extra},store,execute:async()=>{attempts++;if(failure)throw failure;return {done:true};}});
  let id='';
  try { await invoke(); } catch(error) { assert.ok(error instanceof ApprovalRequiredError);id=error.action.id; }
  await store.approveAction(id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});
  await assert.rejects(invoke('browser_click',{},new BrowserPreDispatchError('Covered before input')), /Covered/);
  const key={key:'Enter',keySubmission:{implicitSubmission:false}};
  assert.deepEqual(await invoke('browser_press',key),{done:true});
  assert.equal(attempts,2);
  assert.deepEqual(await invoke(),{done:true}); // Never dispatch an already completed purchase.
  assert.equal(attempts,2);
  await assert.rejects(invoke('browser_click',{pageEvidence:'changed-page-or-control'}),ApprovalRequiredError);
});

test('unknown browser failures cannot be retried under a carried approval', async () => {
  const store = new MemoryRunStore();
  const run=await store.createRun({userId:'unknown@example.invalid',decisionId:null,title:'Order',request:'Order',category:'test',metadata:{}});
  await store.updateRun(run.id,{status:'running'});
  const args={requiresApproval:true,ref:'e1',pageUrl:'https://example.com',pageEvidence:'evidence',elementName:'Buy',elementRole:'button',purpose:'Buy',approvalCategory:'purchase'};
  const op=()=>executeGuardedAction({runId:run.id,toolName:'browser_click',risk:'write_external',preview:'Buy',args,store,execute:async()=>{throw new Error('Connection lost after click');}});
  try {await op();} catch(error) {assert.ok(error instanceof ApprovalRequiredError);await store.approveAction(error.action.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});}
  await assert.rejects(op(),/Connection lost/);
  await assert.rejects(op(),/Verify its outcome/);
});

test('checkout total shows only an explicit unambiguous amount',()=>{
 assert.equal(checkoutDisplayTotal('One bag for CA$16.78 total'),'CA$16.78');
 assert.equal(checkoutDisplayTotal('Order total: $20.00'),'$20.00');
 assert.equal(checkoutDisplayTotal('Item $5 + shipping $3'),undefined);
 assert.equal(checkoutDisplayTotal('total $20 or total $30'),undefined);
});

test('wait-for-user pauses durably and resumes once after acknowledgement', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'wait@example.invalid',decisionId:null,title:'Phone verification',request:'Sign in',category:'test',metadata:{}});
  await store.updateRun(run.id,{status:'running'});
  let executed = 0;
  const invoke = () => executeGuardedAction({runId:run.id,toolName:'browser_request_takeover',risk:'write_external',preview:'Approve the prompt on your phone',args:{mode:'wait_for_user',reason:'Phone approval',instructions:'Approve, then continue'},store,execute:async()=>{executed++;return {userReportedDone:true};}});
  let actionId = '';
  try { await invoke(); assert.fail('must pause'); } catch(error) { assert.ok(error instanceof ApprovalRequiredError); actionId = error.action.id; assert.equal(error.action.input.mode,'wait_for_user'); }
  assert.equal(executed,0);
  await store.approveAction(actionId,run.id,run.userId);
  await store.updateRun(run.id,{status:'running'});
  assert.deepEqual(await invoke(),{userReportedDone:true});
  assert.deepEqual(await invoke(),{userReportedDone:true});
  assert.equal(executed,1);
});
