import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChatFiles, loadChatFiles, chatFileContent} from '../lib/harness/chat-files';
import {appendConversationReply} from '../lib/harness/conversation-reply';
import {MemoryRunStore} from '../lib/harness/store';
import {threadItems} from '../lib/harness/thread';
import {encodeChatFiles, attachmentReplyText} from '../app/chat-files';

test('existing conversation stores and exposes actual uploads while hiding attachment runtime context', async()=>{
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'files@test.invalid', decisionId:null, title:'Existing chat', category:'social', request:'Help', metadata:{}});
  await store.appendMessages(run.id,[{role:'user',content:'Help'},{role:'assistant',content:'What do you need?'}]);
  await store.updateRun(run.id,{status:'done'});
  const chosen = [new File(['invoice total $50'],'My invoice.txt',{type:'text/plain'}),new File(['image-bytes'],'photo.png',{type:'image/png'}),new File(['doc-bytes'],'notes.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})];
  const files = parseChatFiles(await encodeChatFiles(chosen));
  const text = attachmentReplyText('',chosen);
  await appendConversationReply(store,run.id,text,files);
  const uploads=await loadChatFiles(store,run.id);
  assert.equal(uploads.length,3);
  assert.equal(Buffer.from(uploads[0].bytesBase64,'base64').toString(),'invoice total $50');
  assert.ok(uploads.every(file=>file.runId===run.id && !file.name.includes('/')));
  const messages=await store.listMessages(run.id);
  assert.ok(JSON.stringify(messages.at(-1)?.message).includes('invoice total $50'));
  assert.ok(chatFileContent(uploads).some(part=>part.type==='image'));
  const visible=threadItems((await store.getSnapshot(run.id))!,messages);
  assert.equal(visible.at(-1)?.kind,'user');
  const last = visible.at(-1);
  assert.equal(last?.kind==='user' && last.text,text);
  assert.equal(last?.kind === 'user' && last.photos?.length, 1);
  assert.deepEqual(last?.kind === 'user' && last.files?.map(file => file.name), ['My invoice.txt', 'notes.docx']);
  assert.ok(last?.kind === 'user' && last.files?.every(file => file.url.startsWith(`/api/runs/${run.id}/artifacts/`)));
  assert.ok(last?.kind === 'user' && last.photos?.[0].url.startsWith(`/api/runs/${run.id}/artifacts/`));
  assert.doesNotMatch(JSON.stringify(visible), /attachment context|image-bytes|\/workspace/);
  assert.equal(await appendConversationReply(store,run.id,'another',files), 'steering');
  const pending = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  const steer = pending.at(-1);
  assert.equal(steer?.kind === 'user' && steer.text, 'another');
  assert.equal(steer?.kind === 'user' && steer.photos?.length, 1);
  assert.equal(steer?.kind === 'user' && steer.files?.length, 2);
  assert.doesNotMatch(JSON.stringify(pending), /attachment context|image-bytes|\/workspace/);
  assert.equal((await loadChatFiles(store,run.id)).length,6);
});
test('uploads enforce count, total size, base64, and nonempty files',async()=>{
  assert.throws(()=>parseChatFiles([{name:'x',mimeType:'text/plain',dataBase64:'%%%'}]));
  assert.throws(()=>parseChatFiles([{name:'x',mimeType:'text/plain',dataBase64:''}]));
  assert.throws(()=>parseChatFiles(Array(7).fill({name:'x',mimeType:'text/plain',dataBase64:'YQ=='})));
  await assert.rejects(()=>encodeChatFiles([new File([new Uint8Array(3*1024*1024+1)],'large')]),/3 MB/);
});

test('first-turn photos survive reopening and never attach to later text-only replies', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'photos@test.invalid', decisionId:null, title:'Photo', category:'social', request:'Look at this', metadata:{}});
  const {saveChatFiles} = await import('../lib/harness/chat-files');
  const saved = await saveChatFiles(store, run.id, [{name:'photo.png',mimeType:'image/png',dataBase64:'YQ=='}]);
  await store.updateRunMetadata(run.id, {initialAttachmentIds: saved.map(file => file.id)});
  await store.appendMessages(run.id, [{role:'user',content:'Look at this'}, {role:'assistant',content:'I see it'}, {role:'user',content:'thanks'}]);
  const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.equal(items[0].kind === 'user' && items[0].photos?.length, 1);
  assert.equal(items[2].kind === 'user' && items[2].photos?.length, undefined);
});


test('first-turn files survive reopening without leaking onto later messages', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'files@test.invalid', decisionId:null, title:'Files', category:'social', request:'Review', metadata:{}});
  const {saveChatFiles} = await import('../lib/harness/chat-files');
  const saved = await saveChatFiles(store, run.id, [{name:'My budget.pdf',mimeType:'application/pdf',dataBase64:'YQ=='}]);
  await store.updateRunMetadata(run.id, {initialAttachmentIds: saved.map(file => file.id), initialAttachmentNames: {[saved[0].id]: 'My budget.pdf'}});
  await store.appendMessages(run.id, [{role:'user',content:'Review'}, {role:'assistant',content:'Okay'}, {role:'user',content:'thanks'}]);
  const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.equal(items[0].kind === 'user' && items[0].files?.[0].name, 'My budget.pdf');
  assert.equal(items[2].kind === 'user' && items[2].files?.length, undefined);
});
