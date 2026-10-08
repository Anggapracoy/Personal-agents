import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingInteractionSummary} from '../app/pending-interaction';
import type {RunningTask} from '../lib/types';
import type {AgentAction} from '../lib/harness/types';
test('all pending input kinds produce declined receipts without mutating server actions',()=>{
 for(const toolName of ['ask_questions','connector_request_connection','browser_request_signin','browser_request_takeover','google_request_reconnect','vault_request_item','vault_fill_login','vault_fill_payment','gmail_send_draft','browser_click','apple_device']){
  const task={actionId:'a',approvalKind:'external',nativeAction:toolName==='apple_device'?{}:undefined} as RunningTask;
  const action={id:'a',toolName,status:'proposed',input:{name:'Notion',approvalCategory:'purchase'},result:null} as unknown as AgentAction;
  const summary=pendingInteractionSummary(task,action);
  assert.equal(summary.id,'answers:a');assert.equal(summary.answers[0].answer,'Declined');assert.equal(action.status,'proposed');
 }
});
