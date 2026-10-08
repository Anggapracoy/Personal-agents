import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGoogleSecrets, sourceAccountIdOf } from '../lib/harness/google-secrets';
import { createGoogleToolRegistry } from '../lib/harness/google-tools';
import { MemoryRunStore } from '../lib/harness/store';
test('iCloud source IDs do not replace connected Google credentials or Calendar tools', async () => {
 const metadata={executionContext:{emailProvider:'icloud',sourceAccountId:'icloud-mailbox'}};
 assert.equal(sourceAccountIdOf(metadata),null);
 assert.equal(sourceAccountIdOf({executionContext:{sourceAccountId:'google-mailbox'}}),'google-mailbox');
 let primaryReads=0;
 const secrets=await prepareGoogleSecrets('routing@test.invalid',undefined,sourceAccountIdOf(metadata),{
  getPrimaryGoogleCredentials:async()=>{primaryReads++;return {connectionId:'google-primary',accessToken:'fixture-token'};},
  getGoogleConnectionAccessToken:async()=>{throw new Error('An iCloud UUID must not select Google credentials');},
 });
 assert.equal(primaryReads,1);assert.equal(secrets.google_connection_id,'google-primary');
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'routing@test.invalid',decisionId:null,title:'Book meeting',category:'schedule',request:'Book it',metadata});
 await store.putSecrets(run.id,secrets);
 const registry=await createGoogleToolRegistry({runId:run.id,userId:run.userId,stepId:'routing',store,connections:{getPrimaryGoogleConnectionId:async()=> 'google-primary',getGoogleConnectionAccessToken:async()=> 'fixture-token'}});
 assert.ok(registry.tools.calendar_create_event);
 assert.deepEqual(registry.unavailable,[]);
 assert.equal((await store.getRun(run.id))!.metadata.executionContext && sourceAccountIdOf((await store.getRun(run.id))!.metadata),null);
});

test('discarded iCloud account IDs cannot keep an unbound stale Google token usable',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'stale-routing@test.invalid',decisionId:null,title:'Meeting',category:'schedule',request:'Book',metadata:{executionContext:{emailProvider:'icloud',sourceAccountId:'icloud-id'}}});
 await store.putSecrets(run.id,{google_connection_id:'icloud-id',google_access_token:'stale-token'});
 const registry=await createGoogleToolRegistry({runId:run.id,userId:run.userId,stepId:'stale',store,connections:{getPrimaryGoogleConnectionId:async()=>null,getGoogleConnectionAccessToken:async()=>{throw new Error("Unavailable");}}});
 assert.deepEqual(registry.tools,{});assert.deepEqual(registry.unavailable,['Authenticated Gmail and Calendar']);
});
