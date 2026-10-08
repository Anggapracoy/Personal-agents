import test from 'node:test';import assert from 'node:assert/strict';
import{tool}from'ai';import{z}from'zod';import{MemoryRunStore}from'../lib/harness/store';import{steerableTools}from'../lib/harness/steering';import{taskFromRun}from'../app/workspace-model';
test('old browser actions do not show the computer on a new non-browser turn',async()=>{
 const store=new MemoryRunStore();const run=await store.createRun({userId:'test',decisionId:null,category:'test',title:'Chat',request:'Open page',metadata:{}});await store.updateRun(run.id,{status:'running'});
 const action=await store.createAction({runId:run.id,stepId:null,toolName:'browser_open',risk:'read',preview:'Open',input:{}});await store.completeAction(action.id,'executed',{});await store.updateRunMetadata(run.id,{browserUsed:true});
 await store.updateRun(run.id,{status:'done'});await store.acceptReply(run.id,{role:'user',content:'What does this mean?'});
 assert.equal(taskFromRun((await store.getSnapshot(run.id))!).browserUsed,false);
 const make=()=>tool({inputSchema:z.object({}),execute:async()=>({ok:true})});const tools=steerableTools({browser_run:make(),web_search_exa:make()},store,run.id);const options={toolCallId:'test',messages:[],context:undefined};
 await tools.web_search_exa.execute!({},options);assert.equal(taskFromRun((await store.getSnapshot(run.id))!).browserUsed,false);
 await tools.browser_run.execute!({},options);assert.equal(taskFromRun((await store.getSnapshot(run.id))!).browserUsed,true);
 await tools.web_search_exa.execute!({},options);assert.equal(taskFromRun((await store.getSnapshot(run.id))!).browserUsed,true);
});
