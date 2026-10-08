import assert from 'node:assert/strict';import test from 'node:test';
import {MemoryRunStore} from '../lib/harness/store';import {recordAgentResult} from '../lib/harness/model';import {threadItems} from '../lib/harness/thread';import {presentResultInputSchema,resultInputForFeature} from '../lib/harness/result-schema';
const base={outcome:'completed' as const,summary:'Trip plan',details:'Trip plan',verified:true,externalChange:false,options:[],followUpActions:[],facts:[],links:[],moneySaved:null,recommendedNextStep:null};
const blocks=[{type:'text' as const,style:'paragraph' as const,text:'First plan.'}];
test('updates publish immediately, stay in order across replies and finalization, and do not complete the run',async()=>{
 const store=new MemoryRunStore();const run=await store.createRun({userId:'test',decisionId:null,category:'travel',title:'Trip',request:'Plan my trip',metadata:{}});await store.updateRun(run.id,{status:'running'});
 await store.appendMessages(run.id,[{role:'user',content:'Plan my trip'}]);
 const update=await recordAgentResult(store,run.id,{...base,phase:'update',blocks});assert.equal(update.accepted,true);assert.equal(update.phase,'update');assert.equal((await store.getRun(run.id))?.result,null);assert.equal((await store.getRun(run.id))?.status,'running');
 let items=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id));assert.deepEqual(items.map(x=>x.kind),['user','blocks']);const firstId=items[1].id;
 await store.appendMessages(run.id,[{role:'user',content:'Include the park'}]);
 const final=await recordAgentResult(store,run.id,{...base,phase:'final',blocksOnly:true,blocks:[{...blocks[0],text:'Updated plan.'}]});assert.equal(final.blocksOnly,true);
 await store.appendMessages(run.id,[{role:'user',content:'Thanks'}]);
 items=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id));assert.deepEqual(items.map(x=>x.kind),['user','blocks','user','blocks','user']);assert.equal(items[1].id,firstId);assert.ok(items[1].kind==='blocks'&&items[1].createdAt);
 const result=(await store.getRun(run.id))!.result;await store.finishRunIfNoSteering(run.id,result);assert.deepEqual(threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id)).map(x=>x.kind),['user','blocks','user','blocks','user']);
});
test('empty updates and premature blocks-only updates do not publish or store a final result',async()=>{
 const store=new MemoryRunStore();const run=await store.createRun({userId:'test',decisionId:null,category:'travel',title:'Trip',request:'Plan',metadata:{}});
 for(const extra of [{blocks:[]},{blocks,blocksOnly:true}])assert.equal((await recordAgentResult(store,run.id,{...base,phase:'update',...extra})).accepted,false);
 assert.equal((await store.listMessages(run.id)).length,0);assert.equal((await store.getRun(run.id))?.result,null);
});
test('feature-disabled schema omits intermediate block publication controls',()=>{
 const parsed=resultInputForFeature(false).parse({...base,phase:'update',blocks});assert.equal('phase' in parsed,false);assert.equal('blocks' in parsed,false);
 assert.equal(presentResultInputSchema.parse(base).phase,'final');
});

test('blocks-only results do not also emit legacy link cards into the opening message', async()=>{
 const store=new MemoryRunStore();const run=await store.createRun({userId:'test',decisionId:null,category:'travel',title:'Trip',request:'Research',metadata:{}});
 await store.appendMessages(run.id,[{role:'user',content:'Research'},{role:'assistant',content:'I’ll find options.'}]);
 await recordAgentResult(store,run.id,{...base,blocksOnly:true,blocks,options:[{id:'a',name:'Museum',description:'An option',sourceUrl:'https://example.com',status:'Found',recommended:true}]});
 const items=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id));
 assert.equal(items.some(item=>item.kind==='options'),false);
 assert.equal(items.filter(item=>item.kind==='blocks').length,1);
 assert.equal(items.find(item=>item.kind==='agent')?.text,'I’ll find options.');
});

test('lead-in is a new persisted message before blocks, without altering the opening',async()=>{
 const store=new MemoryRunStore();const run=await store.createRun({userId:'test',decisionId:null,category:'travel',title:'Trip',request:'Research',metadata:{}});
 await store.appendMessages(run.id,[{role:'user',content:'Research'},{role:'assistant',content:'I’ll look into it.'}]);
 const result=await recordAgentResult(store,run.id,{...base,leadIn:'I’d pick the museum for Wednesday.',blocks});
 assert.equal(result.replyComplete,true);
 const items=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id));
 assert.deepEqual(items.map(item=>item.kind),['user','agent','agent','blocks']);
 assert.equal(items[1].kind==='agent'&&items[1].text,'I’ll look into it.');
 assert.equal(items[2].kind==='agent'&&items[2].text,'I’d pick the museum for Wednesday.');
 assert.equal((await store.getRun(run.id))?.result?.leadIn,'I’d pick the museum for Wednesday.');
 const rejected=await recordAgentResult(store,run.id,{...base,leadIn:'Intro',blocks,blocksOnly:true});assert.equal(rejected.accepted,false);
 const disabled=resultInputForFeature(false).parse({...base,leadIn:'Intro',blocks});assert.equal('leadIn' in disabled,false);
});
