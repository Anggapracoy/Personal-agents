import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryRunStore } from '../lib/harness/store';
import { attachmentMessageSchema, sendAttachments } from '../lib/harness/attachments';
import { threadItems } from '../lib/harness/thread';
import { combineMessageResults } from '../lib/message-results';

async function fixture() {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'attachments', decisionId: null, category: 'social', request: 'Send deliverables', title: 'Files', metadata: {} });
  await store.updateRun(run.id, { status: 'running' });
  const specs = [['one.png', 'image/png'], ['two.jpg', 'image/jpeg'], ['clip.mp4', 'application/octet-stream'], ['report.pdf', 'application/pdf'], ['three.webp', 'image/webp']];
  const artifacts = await Promise.all(specs.map(([name,mimeType])=>store.createArtifact({runId:run.id,actionId:null,name,mimeType,bytesBase64:'dGVzdA=='})));
  return {store,run,artifacts,data:{attachments:artifacts.map(a=>({artifactId:a.id,description:a.name})),caption:'Your deliverables'}};
}

test('mixed delivery preserves order and existing viewers, captions once, retries once and resends on request',async()=>{
  const {store,run,data,artifacts}=await fixture();
  const sent=await sendAttachments(store,run.id,data);
  assert.equal(sent.attachmentCount,5);
  assert.equal(sent.messageIds.length,4);
  let items=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id)).filter(item => item.kind === "agent");
  assert.deepEqual(items.map(i=>i.photos?'photo':i.videos?'video':'file'),['photo','video','file','photo']);
  assert.deepEqual(items.flatMap(i=>(i.photos??i.videos??i.files??[]).map(a=>a.id)),artifacts.map(a=>a.id));
  assert.equal(items.filter(i=>i.text===data.caption).length,1);
  assert.deepEqual(combineMessageResults(items),items);
  await store.appendMessages(run.id,[{role:'user',content:'[runtime] Continue'}]);
  assert.equal((await sendAttachments(store,run.id,data)).alreadySent,true);
  assert.equal((await store.listMessages(run.id)).length,5);
  await store.appendMessages(run.id,[{role:'user',content:'Send again'}]);
  assert.notEqual((await sendAttachments(store,run.id,data)).messageId,sent.messageId);
  items=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id)).filter(item => item.kind === "agent");
  assert.equal(items.filter(i=>i.kind==='agent').length,8);
});

test('whole mixed batch is validated before any message is published',async()=>{
  const {store,run,data}=await fixture();
  await assert.rejects(sendAttachments(store,run.id,{...data,attachments:[...data.attachments,{artifactId:'missing',description:'Missing'}]}),/from this conversation/);
  assert.equal((await store.listMessages(run.id)).length,0);
  await assert.rejects(sendAttachments(store,run.id,{...data,attachments:[...data.attachments,data.attachments[0]]}),/only once/);
  await assert.rejects(sendAttachments(store,run.id,data,AbortSignal.abort()),/no longer running/);
  assert.equal((await store.listMessages(run.id)).length,0);
  assert.equal(attachmentMessageSchema.safeParse({attachments:[]}).success,false);
  assert.equal(attachmentMessageSchema.safeParse({attachments:Array(11).fill(data.attachments[0])}).success,false);
});

test('historical message payloads still render through the original viewers',async()=>{
  const {store,run,artifacts}=await fixture();
  for(const [key,field,index] of [['photoMessage','photos',0],['videoMessage','videos',2],['fileMessage','files',3]] as const){
    await store.appendMessages(run.id,[{role:'assistant',content:'Old delivery',providerOptions:{wdyt:{[key]:{[field]:[{artifactId:artifacts[index].id,description:'Old attachment'}],caption:''}}}}]);
  }
  const items=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id)).filter(item => item.kind === "agent");
  assert.equal(items[0].photos?.[0].id,artifacts[0].id);
  assert.equal(items[1].videos?.[0].id,artifacts[2].id);
  assert.equal(items[2].files?.[0].id,artifacts[3].id);
});

test('only unified delivery is registered and prompted',()=>{
  const tools=readFileSync('lib/harness/tools.ts','utf8');
  const prompt=readFileSync('lib/harness/model.ts','utf8');
  assert.match(tools,/send_attachments: tool/);
  assert.match(prompt,/send_attachments/);
  for(const name of ['send_files','send_photos','send_videos']){
    assert.equal(tools.includes(name),false);
    assert.equal(prompt.includes(name),false);
  }
});

test('published attachments retain their exact identities after files with the same name are recaptured',async()=>{
 const {store,run,artifacts}=await fixture();
 await sendAttachments(store,run.id,{attachments:[{artifactId:artifacts[0].id,description:'Original photo'},{artifactId:artifacts[3].id,description:'Original PDF'}],caption:''});
 await store.createArtifact({runId:run.id,actionId:null,name:artifacts[0].name,mimeType:'image/png',bytesBase64:'bmV3'});
 await store.createArtifact({runId:run.id,actionId:null,name:artifacts[3].name,mimeType:'application/pdf',bytesBase64:'bmV3'});
 const snapshot=(await store.getSnapshot(run.id))!;
 const items=threadItems(snapshot,await store.listMessages(run.id)).filter(item=>item.kind==='agent');
 assert.equal(items[0].photos?.[0].id,artifacts[0].id);
 assert.equal(items[1].files?.[0].id,artifacts[3].id);
 assert.ok(snapshot.artifacts.every(a=>!('bytesBase64' in a)));
});
