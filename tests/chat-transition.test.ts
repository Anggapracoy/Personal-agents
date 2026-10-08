import test from 'node:test';
import assert from 'node:assert/strict';
import {runRouteMatches, taskFromRun} from '../app/workspace-model';
import {executeGuardedAction} from '../lib/harness/actions';
import {MemoryRunStore} from '../lib/harness/store';

test('run routes survive running, completed and failed row replacements', () => {
  for (const route of ['run-1', 'remote-run-1', 'completed-run-1', 'failed-run-1']) {
    assert.equal(runRouteMatches(route, 'run-1'), true);
    assert.equal(runRouteMatches(route, 'run-2'), false);
    assert.equal(runRouteMatches(route, undefined), false);
  }
});

test('work labels retain the last tool between calls', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'status@test.invalid',decisionId:null,title:'Confirm Tuesday',category:'schedule',request:'Confirm Tuesday',metadata:{}});
  const snapshot = (await store.getSnapshot(run.id))!;
  const action = {id:'draft',runId:run.id,stepId:null,toolName:'gmail_create_draft',input:{},preview:'Draft',risk:'write_reversible',status:'executed',result:{},approvedBy:null,approvedAt:null,executedAt:run.createdAt,createdAt:run.createdAt} as const;
  snapshot.actions = [action, {...action,id:'send',toolName:'gmail_send_draft',risk:'write_external',status:'approved',preview:'Send'}];
  snapshot.status = 'running';
  assert.equal(taskFromRun(snapshot).subtitle, '');
  snapshot.metadata.currentActivityActionId = 'send';
  assert.equal(taskFromRun(snapshot).subtitle, 'Sending email');
  snapshot.actions[1] = {...snapshot.actions[1],status:'executed'};
  assert.equal(taskFromRun(snapshot).subtitle, 'Sending email');
});


test('current action records execution and its success or failure', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'activity@test.invalid',decisionId:null,title:'Check inbox',category:'social',request:'Check inbox',metadata:{}});
  await store.updateRun(run.id, {status:'running'});
  assert.equal((await store.getSnapshot(run.id))!.metadata.currentActivityActionId ?? null, null);
  for (const fail of [false, true]) {
    const work = executeGuardedAction({runId:run.id, toolName:'gmail_search', risk:'read', preview:'Search Gmail', args:{}, store,
      execute: async () => {
        const snapshot = (await store.getSnapshot(run.id))!;
        assert.equal(snapshot.actions.find(action => action.id === snapshot.metadata.currentActivityActionId)?.toolName, 'gmail_search');
        if (fail) throw new Error('test failure');
        return {};
      },
    });
    if (fail) await assert.rejects(work, /test failure/); else await work;
    const finished = (await store.getSnapshot(run.id))!;
    assert.equal(finished.actions.find(action => action.id === finished.metadata.currentActivityActionId)?.status, fail ? 'failed' : 'executed');
  }
});

test('task work persists between tools, yields to typing, and ends on pause or completion', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'continuity@test.invalid',decisionId:null,title:'Invoices',category:'social',request:'Check invoices',metadata:{}});
  await store.updateRun(run.id, {status:'running'});
  assert.equal(taskFromRun((await store.getSnapshot(run.id))!).subtitle, '');
  await executeGuardedAction({runId:run.id,toolName:'gmail_search',risk:'read',preview:'Search',args:{},store,execute:async()=>({})});
  assert.equal(taskFromRun((await store.getSnapshot(run.id))!).subtitle, 'Searching Gmail');
  await store.updateRunMetadata(run.id, {replyTyping:true});
  assert.equal(taskFromRun((await store.getSnapshot(run.id))!).subtitle, 'Typing');
  await store.updateRunMetadata(run.id, {replyTyping:false});
  assert.equal(taskFromRun((await store.getSnapshot(run.id))!).subtitle, 'Searching Gmail');
  const {conversationWorkLabel} = await import('../lib/harness/thread');
  for (const status of ['done','paused','awaiting_approval','failed','cancelled'] as const) {
    await store.updateRun(run.id,{status});
    assert.equal(conversationWorkLabel((await store.getSnapshot(run.id))!),null);
  }
});

test('Apple completion snapshots never become generic approval requests', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'apple-transition@test.invalid',decisionId:null,title:'Reminder',category:'schedule',request:'Create a reminder',metadata:{}});
  const action = await store.createAction({runId:run.id,stepId:null,toolName:'apple_device',input:{operation:'reminders.create',parameters:{title:'Groceries'}},preview:'Create reminder',risk:'write_external'});
  await store.updateRun(run.id,{status:'awaiting_approval'});
  for (const status of ['proposed','approved','executed'] as const) {
    const snapshot = (await store.getSnapshot(run.id))!;
    snapshot.actions = [{...action,status}];
    const task = taskFromRun(snapshot);
    assert.equal(task.status, status === 'executed' ? 'running' : 'waiting');
    assert.equal(Boolean(task.nativeAction),status !== 'executed');
    if (status !== 'executed') assert.equal(task.subtitle, 'Waiting for your iPhone');
  }
  const snapshot = (await store.getSnapshot(run.id))!;
  snapshot.actions = [];
  assert.equal(taskFromRun(snapshot).status,'running');
  snapshot.actions = [{...action,toolName:'gmail_send_draft',status:'proposed'}];
  assert.equal(taskFromRun(snapshot).approvalKind,'email_send');
  assert.equal(taskFromRun(snapshot).status,'needs_approval');
});

test('parallel search snapshots never flash a generic approval or replace an Apple panel', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'parallel@test.invalid',decisionId:null,title:'Dinner',category:'food',request:'Find dinner',metadata:{}});
  const apple = await store.createAction({runId:run.id,stepId:null,toolName:'apple_device',input:{operation:'maps.search',parameters:{query:'restaurant'}},preview:'Find dinner',risk:'read'});
  const search = await store.createAction({runId:run.id,stepId:null,toolName:'web_search',input:{},preview:'Search restaurants',risk:'read'});
  const snapshot = (await store.getSnapshot(run.id))!;
  snapshot.status = 'awaiting_approval';
  for (const status of ['proposed','approved'] as const) {
    snapshot.actions = [{...apple,status},search];
    const task = taskFromRun(snapshot);
    assert.equal(task.actionId,apple.id); assert.equal(task.nativeAction?.operation,'maps.search');
  }
  snapshot.actions = [{...apple,status:'executed'},search];
  const task = taskFromRun(snapshot);
  assert.equal(task.actionId,undefined); assert.equal(task.status,'running');
});

test('saving a final reply clears typing before the completed message is observable', async () => {
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'typing-arrival@test.invalid',decisionId:null,title:'Greeting',category:'social',request:'hey',metadata:{replyTyping:true}});
 await store.updateRun(run.id,{status:'running'});
 await store.appendMessages(run.id,[{role:'assistant',content:'Hey!'}],{finishReplyTyping:true});
 const snapshot=(await store.getSnapshot(run.id))!;
 assert.equal(snapshot.metadata.replyTyping,false);
 assert.equal((await store.listMessages(run.id)).at(-1)?.message.content,'Hey!');
 const {conversationWorkActivity}=await import('../lib/harness/thread');
 assert.notEqual(conversationWorkActivity(snapshot)?.icon,'typing');
});
