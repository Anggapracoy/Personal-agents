import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { iCloudCredentials, readICloudInbox, verifyICloudMail, iCloudAuthRejected, readICloudMessage, iCloudMessageRef, allICloudRecipientsRejected, type ICloudClientFactory } from '../lib/mail/icloud-client';
import { createICloudTools } from '../lib/mail/icloud-tools';
import { MemoryRunStore } from '../lib/harness/store';
import { taskFromRun } from '../app/workspace-model';
const accountId = 'be5881ae-ff8a-43b1-93b4-6eb40ed3176b';
const fakePassword = 'abcd-efgh-ijkl-mnop';
test('only primary iCloud addresses and app-specific passwords are admitted', () => {
  assert.equal(iCloudCredentials(' OWNER@ICLOUD.COM ', fakePassword).email, 'owner@icloud.com');
  assert.throws(() => iCloudCredentials('owner@example.com', fakePassword));
  assert.throws(() => iCloudCredentials('owner@icloud.com', 'usual-password'));
  assert.equal(iCloudAuthRejected({ authenticationFailed: true }), true);
  assert.equal(iCloudAuthRejected(new Error('connection timeout')), false);
});
test('iCloud reads use verified TLS, read-only mailboxes and bounded downloads without changing read flags', async () => {
  const calls: unknown[] = [];
  let loggedOut = 0;
  const factory: ICloudClientFactory = options => {
    assert.equal(options.host, 'imap.mail.me.com'); assert.equal(options.secure, true); assert.equal(options.logger, false);
    return {
      on: () => {}, connect: async () => {}, logout: async () => { loggedOut++; }, close: () => {},
      mailboxOpen: async (...args: unknown[]) => { calls.push(args); return { exists: 3, uidValidity: BigInt(101) }; },
      fetchAll: async () => [{ uid: 9, size: 150, flags: new Set(), envelope: { date: new Date() } }],
      download: async (...args: unknown[]) => { calls.push(args); return { content: Readable.from('From: Shop <shop@example.com>\r\nTo: owner@icloud.com\r\nSubject: Your booking\r\nMessage-ID: <booking@example.com>\r\nDate: Sun, 4 Oct 2026 12:00:00 +0000\r\n\r\nYour table is booked. https://example.com/booking') }; },
    } as any;
  };
  await verifyICloudMail('owner@icloud.com', fakePassword, factory);
  const messages = await readICloudInbox('owner@icloud.com', fakePassword, accountId, 100, factory);
  assert.equal(messages[0].id, `icloud:${accountId}:101:9`);
  assert.equal(messages[0].subject, 'Your booking'); assert.deepEqual(messages[0].labels, ['UNREAD']);
  assert.deepEqual(calls[0], ['INBOX', { readOnly: true }]);
  assert.deepEqual(calls[2], ['9', undefined, { uid: true, maxBytes: 3_000_000 }]);
  assert.equal(loggedOut, 2);
  const before = calls.length;
  assert.deepEqual(await readICloudInbox('owner@icloud.com', fakePassword, accountId, 100, factory, new Set([messages[0].id])), []);
  assert.equal(calls.length, before + 1); // mailbox metadata only; no repeat body download
  assert.equal((await readICloudMessage('owner@icloud.com', fakePassword, accountId, messages[0].id, factory)).subject, 'Your booking');
  assert.throws(() => iCloudMessageRef('different-account', messages[0].id));
  await assert.rejects(readICloudMessage('owner@icloud.com', fakePassword, accountId, `icloud:${accountId}:999:9`, factory), /mailbox changed/);
});
test('iCloud sending waits for explicit review and applies the exact approved edit once', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'owner@test.invalid', decisionId: null, category: 'social', title: 'Email', request: 'Send an email', metadata: {} });
  await store.updateRun(run.id, { status: 'running' });
  const sent: unknown[] = [];
  const tools = await createICloudTools({ userId: run.userId, runId: run.id, stepId: 'turn', store, services: {
    listICloudAccounts: async () => [{ id: accountId, email: 'owner@icloud.com', enabled: true, needsReconnect: false }],
    iCloudSecret: async (owner, id) => { assert.equal(owner, run.userId); assert.equal(id, accountId); return { id, email: 'owner@icloud.com', password: fakePassword, revision: "fixture" }; },
    recordICloudCheck: async () => {}, readICloudInbox: async () => [], readICloudMessage: async () => { throw new Error("No fixture source"); },
    sendICloudMessage: async (_email, _password, message) => { sent.push(message); return { messageId: message.messageId, accepted: message.to, rejected: [] }; },
  } });
  const args = { accountId, to: ['friend@example.com'], subject: 'Hi', body: 'Original' };
  const call = () => (tools.icloud_send_email.execute as any)(args, { toolCallId: 'send', messages: [] });
  await assert.rejects(call(), /ApprovalRequired/); assert.equal(sent.length, 0);
  let snapshot = await store.getSnapshot(run.id);
  assert.ok(snapshot);
  assert.equal(taskFromRun(snapshot).approvalKind, 'email_send');
  await store.approveAction(snapshot.actions[0].id, run.id, run.userId, { subject: 'Edited', body: 'Exact approved text' });
  await store.updateRun(run.id, { status: 'running' });
  await call(); await call();
  assert.equal(sent.length, 1); assert.equal((sent[0] as any).subject, 'Edited'); assert.equal((sent[0] as any).body, 'Exact approved text');
  snapshot = await store.getSnapshot(run.id); assert.ok(snapshot); assert.equal(snapshot.actions[0].status, 'executed');
});

test('partial iCloud delivery preserves receipts and retries only rejected recipients with new review',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'partial@test.invalid',decisionId:'partial-decision',category:'social',title:'Email',request:'Send',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 const deliveries:string[][]=[];
 let rejectAll=false;
 const services:NonNullable<Parameters<typeof createICloudTools>[0]['services']>={
  listICloudAccounts:async()=>[{id:accountId,email:'owner@icloud.com',enabled:true,needsReconnect:false}],
  iCloudSecret:async()=>({id:accountId,email:'owner@icloud.com',password:fakePassword,revision:'fixture'}),
  recordICloudCheck:async()=>{},readICloudInbox:async()=>[],readICloudMessage:async()=>{throw Error('unused');},
  sendICloudMessage:async(_email,_password,message)=>{deliveries.push(message.to);return {messageId:message.messageId,accepted:rejectAll?[]:[message.to[0]],rejected:rejectAll?message.to:message.to.slice(1)};},
 };
 const tools=await createICloudTools({userId:run.userId,runId:run.id,stepId:'partial',store,services});
 const args={accountId,to:['alice@example.com','bob@example.com'],subject:'Hi',body:'Approved text'};
 const call=(to=args.to,retryOfActionId?:string)=>(tools.icloud_send_email.execute as any)({...args,to,...(retryOfActionId?{retryOfActionId}:{})},{toolCallId:'send',messages:[]});
 await assert.rejects(call(),/ApprovalRequired/);
 let pending=(await store.getSnapshot(run.id))!.actions.find(action=>action.status==='proposed')!;
 await store.approveAction(pending.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});
 const partial=await call();
 assert.equal(partial.sent,false);assert.equal(partial.deliveryStatus,'partial');assert.deepEqual(partial.retryRecipients,['bob@example.com']);
 await call();assert.equal(deliveries.length,1);
 const later=await store.createRun({userId:run.userId,decisionId:run.decisionId,category:'social',title:'Retry email',request:'Retry',metadata:{}});
 await store.updateRun(later.id,{status:'running'});
 const laterTools=await createICloudTools({userId:run.userId,runId:later.id,stepId:'later',store,services});
 const laterCall=(value:unknown)=>(laterTools.icloud_send_email.execute as any)(value,{toolCallId:'later',messages:[]});
 const copied=await laterCall(args);assert.equal(copied.actionId,partial.actionId);assert.equal(deliveries.length,1);
 await assert.rejects(laterCall({...args,to:partial.retryRecipients,retryOfActionId:copied.actionId}),/ApprovalRequired/);
 assert.equal(deliveries.length,1);await store.rejectPendingActions(later.id);
 await assert.rejects(call(['alice@example.com'],partial.actionId),/Only recipients/);
 await assert.rejects(call(partial.retryRecipients),/ApprovalRequired/);assert.equal(deliveries.length,1);
 pending=(await store.getSnapshot(run.id))!.actions.find(action=>action.status==='proposed')!;
 await store.approveAction(pending.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});
 assert.equal((await call(partial.retryRecipients)).deliveryStatus,'sent');
 assert.deepEqual(deliveries,[['alice@example.com','bob@example.com'],['bob@example.com']]);
 rejectAll=true;
 await assert.rejects(call(['carol@example.com']),/ApprovalRequired/);
 pending=(await store.getSnapshot(run.id))!.actions.find(action=>action.status==='proposed')!;
 await store.approveAction(pending.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});
 const rejected=await call(['carol@example.com']);assert.equal(rejected.deliveryStatus,'rejected');
 await call(['carol@example.com']);assert.equal(deliveries.length,3);
 await assert.rejects(call(rejected.retryRecipients,rejected.actionId),/ApprovalRequired/);
 pending=(await store.getSnapshot(run.id))!.actions.find(action=>action.status==='proposed')!;
 await store.approveAction(pending.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});
 rejectAll=false;assert.equal((await call(rejected.retryRecipients,rejected.actionId)).sent,true);
 assert.equal(deliveries.length,4);
});

test('only explicit rejection of every recipient is a certain zero-delivery receipt',()=>{
 const recipients=['alice@example.com','bob@example.com'];
 assert.equal(allICloudRecipientsRejected({code:'EENVELOPE',command:'RCPT TO',rejected:recipients},recipients),true);
 assert.equal(allICloudRecipientsRejected({code:'EENVELOPE',command:'RCPT TO',rejected:recipients.slice(1)},recipients),false);
 assert.equal(allICloudRecipientsRejected({code:'ETIMEDOUT',command:'DATA',rejected:recipients},recipients),false);
});
