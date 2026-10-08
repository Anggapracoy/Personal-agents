import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationPushPayload } from '../lib/push-notifications';
import { characterIndexFor } from '../lib/conversation-character';

test('agent alerts use chat title and message with the same avatar and thread across run events', () => {
  const payloads = ['run-completed:run-1:reply-2', 'run-attention:run-2:question-3', 'chat-4'].map(decisionId =>
    conversationPushPayload({ decisionId, title: '**Dinner plans**', body: 'Booked [L’Artusi](https://example.com) for **7**.', conversationId: 'decision:chat-4', ownerEmail: 'owner@example.com' }));
  for (const p of payloads) {
    assert.deepEqual(p.aps.alert, { title: 'Dinner plans', body: 'Booked L’Artusi for 7.' });
    assert.equal(p.aps['mutable-content'], 1);
    assert.equal(p.aps.category, 'conversation.reply');
    assert.match(p.replyAccountKey ?? '', /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(p).includes('owner@example.com'), false);
    assert.equal(p.aps['thread-id'], 'decision:chat-4');
    assert.equal(p.avatarIndex, characterIndexFor('decision:chat-4'));
    assert.ok(Buffer.byteLength(JSON.stringify(p)) < 4096);
  }
  assert.equal(payloads[0].notificationKind, 'run_completion');
  assert.ok('runId' in payloads[0]);
  assert.ok('runId' in payloads[1]);
  assert.ok('decisionId' in payloads[2]);
  assert.equal(payloads[0].runId, 'run-1');
  assert.equal(payloads[1].runId, 'run-2');
  assert.equal(payloads[2].decisionId, 'chat-4');
});

test('archived decisions, completions and approvals are suppressed when queued', async () => {
  const { queueDecisionPushNotifications, queueRunAttentionPushNotification, queueRunCompletionPushNotification } = await import('../lib/push-notifications');
  const saved: Array<{ status: string }> = [];
  let archived = true;
  const db = {
    transaction: async (work: (tx: any) => Promise<unknown>) => work(db),
    execute: async () => [{ decision_id: 'chat', title: 'Chat', archived }],
    insert: () => ({ values: (rows: any) => { saved.push(...(Array.isArray(rows) ? rows : [rows])); return { onConflictDoNothing: () => ({ returning: async () => [{ id: 'job' }] }) }; } }),
  } as unknown as Parameters<typeof queueDecisionPushNotifications>[2];
  await queueDecisionPushNotifications('owner@example.com', [{ id: 'chat', title: 'Chat', subtitle: 'Hello' }] as any, db);
  await queueRunAttentionPushNotification({ ownerEmail: 'owner@example.com', runId: 'run', attentionId: 'approval', title: 'Chat', body: 'Approve?' }, db);
  await queueRunCompletionPushNotification({ ownerEmail: 'owner@example.com', runId: 'run', title: 'Chat', body: 'Finished' }, db);
  assert.deepEqual(saved.map(row => row.status), ['suppressed', 'suppressed', 'suppressed']);
  archived = false;
  await queueRunCompletionPushNotification({ ownerEmail: 'owner@example.com', runId: 'run', completionId: 'new-event', title: 'Chat', body: 'A new result' }, db);
  assert.equal(saved.at(-1)?.status, 'queued');
});

for (const archived of [true, false]) test(archived ? 'an alert queued before archive is suppressed before device lookup or delivery' : 'legacy scheduled completion filler is suppressed even in an unarchived chat', async () => {
  const { deliverPendingPushNotifications } = await import('../lib/push-notifications');
  const keys = ['APNS_TEAM_ID', 'APNS_KEY_ID', 'APNS_BUNDLE_ID', 'APNS_PRIVATE_KEY_BASE64'];
  const previous = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = 'test'; });
  const updates: string[] = [];
  let selects = 0;
  const db = {
    transaction: async (work: (tx: any) => Promise<unknown>) => work(db),
    execute: async () => [{ decision_id: 'chat', title: 'Chat', archived }],
    update: () => ({ set: (value: { status: string }) => { updates.push(value.status); return { where: () => ({ returning: async () => [{ id: 'job' }] }) }; } }),
    select: () => { selects++; return { from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{ id: 'job', ownerEmail: 'owner@example.com', decisionId: 'run-completed:run', title: 'Chat', subtitle: '', body: 'The scheduled task finished.', attempts: 0 }] }) }) }) }; },
  } as unknown as NonNullable<Parameters<typeof deliverPendingPushNotifications>[1]>;
  try {
    const result = await deliverPendingPushNotifications({}, db);
    assert.equal(result.sent, 0);
    assert.equal(result.suppressed, 1);
    assert.equal(selects, 1, 'No device lookup for archived chats');
    assert.equal(updates.at(-1), 'suppressed');
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});

test('empty and canned run completions cannot enter the notification queue', async () => {
  const { queueRunCompletionPushNotification } = await import('../lib/push-notifications');
  const db = { insert: () => { throw new Error('Must not queue a generic alert'); } } as unknown as Parameters<typeof queueRunCompletionPushNotification>[1];
  for (const body of ['', '  ', 'The scheduled task finished.', 'Dash finished the task successfully.']) {
    assert.equal(await queueRunCompletionPushNotification({ ownerEmail: 'owner@example.com', runId: 'run', title: 'Task', body }, db), false);
  }
});

test('updated suggestions get a per-reply notification key but open the original conversation', async () => {
  const { decisionNotificationId, notificationConversation, queueDecisionPushNotifications } = await import('../lib/push-notifications');
  const original = { id: 'invite', title: 'Friday call', subtitle: 'Does Friday work?' };
  const update = { ...original, discoveryUpdateKey: 'new-email' };
  const id = decisionNotificationId(update);
  assert.notEqual(id, decisionNotificationId(original));
  assert.equal(id, decisionNotificationId({ ...update }));
  assert.notEqual(id, decisionNotificationId({ ...update, discoveryUpdateKey: 'next-reply' }));
  const saved: any[] = [];
  const db = {
    transaction: async (work: (tx: any) => Promise<unknown>) => work(db),
    execute: async () => [{ title: 'Friday call', archived: false }],
    insert: () => ({ values: (rows: any[]) => { saved.push(...rows); return { onConflictDoNothing: () => ({ returning: async () => [{ id: 'job' }] }) }; } }),
  } as unknown as Parameters<typeof queueDecisionPushNotifications>[2];
  await queueDecisionPushNotifications('owner@example.com', [update as any], db);
  assert.equal(saved[0].decisionId, id);
  const conversation = await notificationConversation({ ownerEmail: 'owner@example.com', decisionId: id, title: '', subtitle: '' }, db);
  assert.equal(conversation.conversationId, 'decision:invite');
  const payload = conversationPushPayload({ ownerEmail: 'owner@example.com', decisionId: id, title: 'Friday call', body: 'New proposal', conversationId: conversation.conversationId });
  assert.ok('decisionId' in payload);
  assert.equal(payload.decisionId, 'invite');
});

test('delivery discards obsolete suggestions and answered nudges but keeps run results', async () => {
  const { notificationConversation } = await import('../lib/push-notifications');
  let decision: any = { actionableUntil: '2099-01-01T00:00:00Z' };
  let discarded = false;
  let status = 'running';
  const db = { execute: async () => [{ decision_id: 'chat', status, metadata: {}, title: 'Chat', archived: false, decision, discarded }] } as any;
  const resolve = (decisionId = 'chat') => notificationConversation({ ownerEmail: 'owner@example.invalid', decisionId, title: '', subtitle: '' }, db);
  assert.equal((await resolve()).stale, false);
  for (const obsolete of [null, { activeRunId: 'run' }, { result: {} }, { actionableUntil: '2000-01-01T00:00:00Z' }]) {
    decision = obsolete;
    assert.equal((await resolve()).stale, true);
  }
  decision = {}; discarded = true;
  assert.equal((await resolve()).stale, true);
  assert.equal((await resolve('run-attention:run:stuck')).stale, true);
  status = 'awaiting_approval';
  assert.equal((await resolve('run-attention:run:stuck')).stale, false);
  status = 'completed';
  assert.equal((await resolve('run-completed:run')).stale, false);
});

test('Google reconnect notifications have a stable ID per disconnected period and no chat reply action',async()=>{
 const {googleReconnectNotificationId}=await import('../lib/push-notifications');
 const time=new Date('2026-10-03T19:00:00Z');
 const id=googleReconnectNotificationId('connection-1',time);
 assert.equal(googleReconnectNotificationId('connection-1',new Date(time)),id);
 assert.notEqual(googleReconnectNotificationId('connection-1',new Date(time.getTime()+1000)),id);
 const payload=conversationPushPayload({decisionId:id,title:'Reconnect Google',body:'Reconnect Google so Dash can keep checking your email and calendar.',conversationId:'settings-google',ownerEmail:'private@example.com'});
 assert.equal(payload.notificationKind,'google_reconnect');
 assert.equal(payload.aps.category,undefined);
 assert.equal(payload.aps['thread-id'],'google-connection');
 assert.equal(JSON.stringify(payload).includes('private@example.com'),false);
});

test('reconnect delivery is suppressed after recovery, pause, removal or a newer disconnection',async()=>{
 const {googleReconnectNotificationId,notificationConversation}=await import('../lib/push-notifications');
 const time=new Date('2026-10-03T19:00:00Z');
 let account:any={enabled:true,disconnectedAt:time};
 const db:any={select:()=>({from:()=>({where:()=>({limit:async()=>account ? [account] : []})})})};
 const job={ownerEmail:'owner@example.com',decisionId:googleReconnectNotificationId('connection-1',time),title:'Reconnect Google',subtitle:''};
 assert.equal((await notificationConversation(job,db)).stale,false);
 for(const changed of [{enabled:true,disconnectedAt:null},{enabled:false,disconnectedAt:time},null,{enabled:true,disconnectedAt:new Date(time.getTime()+1000)}]){
  account=changed;assert.equal((await notificationConversation(job,db)).stale,true);
 }
});
