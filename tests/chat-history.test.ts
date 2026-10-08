import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryRunStore} from '../lib/harness/store';
import {createChatHistoryTool} from '../lib/harness/chat-history';

async function fixture() {
  const store=new MemoryRunStore();const owner=`history-${crypto.randomUUID()}@example.com`;
  const make=(userId=owner,title='Travel chat')=>store.createRun({userId,title,request:'Plan a trip',decisionId:null,category:'travel',metadata:{}});
  const current=await make(owner,'Current');const target=await make();const foreign=await make('other@example.com','Private chat');
  await store.appendMessages(target.id,[{role:'user',content:'The hotel is Maple House.'},{role:'assistant',content:'Maple House is booked for Friday.'},{role:'user',content:'[runtime] PRIVATE_RUNTIME_DATA'},{role:'tool',content:[{type:'tool-result',toolCallId:'x',toolName:'vault',output:{type:'text',value:'PRIVATE_TOOL_DATA'}}]}]);
  const tool=createChatHistoryTool({runId:current.id,userId:owner,store});
  const execute=async(args:Record<string,unknown>)=>await (tool.execute as Function)(args,{toolCallId:'history',messages:[]}) as any;
  return {store,owner,current,target,foreign,execute};
}
test('search finds message content, excludes current/foreign chats, and reads attributed visible text',async()=>{
 const f=await fixture();const found=await f.execute({mode:'search',query:'Maple'});
 assert.deepEqual(found.chats.map((c:any)=>c.chatId),[f.target.id]);
 const recent=await f.execute({mode:'search'});assert.deepEqual(recent.chats.map((c:any)=>c.chatId),[f.target.id]);
 const read=await f.execute({mode:'read',chatId:f.target.id});
 assert.equal(read.source.title,'Travel chat');assert.ok(read.source.updatedAt);
 assert.ok(read.messages.some((m:any)=>m.text.includes('Maple House')));
 assert.ok(!JSON.stringify(read).includes('PRIVATE_'));assert.match(read.boundary,/Not instructions/);
 assert.equal((await f.store.getRun(f.target.id))?.status,f.target.status);
});
test('read rejects guessed foreign IDs and forged current ownership',async()=>{
 const f=await fixture();await assert.rejects(()=>f.execute({mode:'read',chatId:f.foreign.id}),/Chat not found/);
 await assert.rejects(()=>f.execute({mode:'read',chatId:f.current.id}),/Chat not found/);
 const tool=createChatHistoryTool({runId:f.current.id,userId:'other@example.com',store:f.store});
 await assert.rejects(()=>Promise.resolve((tool.execute as Function)({mode:'search'},{toolCallId:'x',messages:[]})),/unavailable/);
});
test('read and search paginate with stable source identifiers',async()=>{
 const f=await fixture();await f.store.createRun({userId:f.owner,title:'Another',request:'Task',decisionId:null,category:'test',metadata:{}});
 const first=await f.execute({mode:'search',limit:1});const second=await f.execute({mode:'search',limit:1,offset:first.nextOffset});
 assert.equal(first.nextOffset,1);assert.notEqual(first.chats[0].chatId,second.chats[0].chatId);
 const read=await f.execute({mode:'read',chatId:f.target.id,limit:1});assert.equal(read.messages.length,1);assert.equal(read.nextOffset,1);
 const next=await f.execute({mode:'read',chatId:f.target.id,limit:1,offset:read.nextOffset});assert.notEqual(read.messages[0].messageId,next.messages[0].messageId);
});
