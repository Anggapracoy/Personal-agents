import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { MemoryRunStore } from '../lib/harness/store';
import { createRememberTool } from '../lib/harness/memory';
import { rememberLifeFact, getLifeProfile } from '../lib/life-profile';
import { compactLifeMemory, lifeMemoryPrompt } from '../lib/life-memory-context';
import { generateText, stepCountIs } from 'ai';
import { proactiveModel, proactiveProviderOptions } from '../lib/proactive/engine/model';
import { judgeCandidates } from '../lib/proactive/engine/judge';
import { createTemporalContext } from '../lib/temporal';
import { workflowSystemPrompt } from '../lib/harness/model';

const url = process.env.RECOVERY_TEST_DATABASE_URL;
test('typed proactive preferences persist immediately, correct in place, and reach future suggestion context', {skip:!url}, async () => {
 const admin = postgres(url!);
 const name = `proactive_memory_${crypto.randomUUID().replaceAll('-','')}`;
 await admin.unsafe(`create schema ${name}`);
 const client = postgres(url!,{connection:{search_path:name}});
 const db = drizzle(client,{schema});
 try {
  await client`create table mobile_user_states(owner_email text primary key)`;
  await client.unsafe(readFileSync('db/migrations/0011_life_profile_and_memory.sql','utf8'));
  const store = new MemoryRunStore();
  const owner = 'learning@example.invalid';
  const run = await store.createRun({userId:owner,title:'Dinner',request:'Suggest somewhere for dinner',category:'food',decisionId:null,metadata:{}});
  await store.appendMessages(run.id,[{role:'assistant',content:'Try the $250 tasting menu at Bistro Expensive?'},{role:'user',content:'nah I don’t like expensive tasting menus'}]);
  const remember = createRememberTool({store,userId:owner,runId:run.id},(email,args)=>rememberLifeFact(email,args,db));
  const args = {key:'proactive_tasting_menus',category:'proactive_preference' as const,content:'Do not proactively suggest expensive tasting menus. Other restaurants are fine.',quote:'nah I don’t like expensive tasting menus'};
  const options = {toolCallId:'feedback',messages:[],context:{}};
  await remember.execute!(args,options);
  await remember.execute!(args,options);
  let memory = await getLifeProfile(owner,db);
  assert.equal(memory.facts.length,1);
  assert.equal(memory.facts[0].kind,'proactive_preference');
  assert.match(lifeMemoryPrompt(memory),/Do not proactively suggest expensive tasting menus/);
  assert.equal(compactLifeMemory(memory).facts[0].value && (compactLifeMemory(memory).facts[0].value as {content:string}).content,args.content);
  await store.appendMessages(run.id,[{role:'assistant',content:'Never suggest any restaurants.'}]);
  await assert.rejects(async()=>remember.execute!({...args,quote:'Never suggest any restaurants.'},options),/exact quote/);
  await store.appendMessages(run.id,[{role:'user',content:'Actually tasting menus are fine now, suggest them again'}]);
  await remember.execute!({...args,content:'Tasting menu suggestions are welcome again.',quote:'Actually tasting menus are fine now, suggest them again'},options);
  memory = await getLifeProfile(owner,db);
  assert.equal(memory.facts.length,1);
  assert.equal(memory.facts[0].value.content,'Tasting menu suggestions are welcome again.');
  assert.equal((await getLifeProfile('other@example.invalid',db)).facts.length,0);
  await store.appendMessages(run.id,[{role:'user',content:'I dislike buffets but do not remember this'}]);
  const refused = await remember.execute!({...args,key:'buffets',quote:'I dislike buffets',content:'Dislikes buffets'},options);
  assert.equal((refused as {saved:boolean}).saved,false);
  assert.equal((await getLifeProfile(owner,db)).facts.length,1);

  if (process.env.PROACTIVE_LIVE_TEST !== 'true') return;
  for (const [id,context,message,expected] of [
   ['explicit','Want to try a $250 tasting menu?','nah I don’t like expensive tasting menus',true],
   ['contextual','Want to try a $250 tasting menu at Bistro Expensive?','nah I don’t like this',true],
   ['temporary','Want to try a $250 tasting menu?','not tonight, maybe next week',false],
   ['done','Should I remind you to reply to Sam?','already done',false],
   ['privacy','Want to try a tasting menu?','I dislike tasting menus but do not remember this',false],
  ] as const) {
   const liveOwner = `${id}@example.invalid`;
   const liveRun = await store.createRun({userId:liveOwner,title:'Proactive suggestion',request:'Help with this suggestion',category:'food',decisionId:null,metadata:{}});
   await store.appendMessages(liveRun.id,[{role:'assistant',content:context},{role:'user',content:message}]);
   const tool = createRememberTool({store,userId:liveOwner,runId:liveRun.id},(email,args)=>rememberLifeFact(email,args,db));
   await generateText({model:proactiveModel(),providerOptions:proactiveProviderOptions(),system:workflowSystemPrompt, messages:[{role:'assistant',content:context},{role:'user',content:message}],tools:{remember:tool},stopWhen:stepCountIs(3),abortSignal:AbortSignal.timeout(60000)});
   const saved = await getLifeProfile(liveOwner,db);
   assert.equal(saved.facts.some(f=>f.kind==='proactive_preference'),expected,id);
   if (id==='explicit') {
    const verdicts = await judgeCandidates({life:saved,temporal:createTemporalContext('America/Toronto'),items:[{id:'disliked',kind:'suggestion',evidence:{proposal:'Book a $250 tasting menu at a new restaurant for this user',userRequested:false}},{id:'unrelated',kind:'loop',evidence:{from:'Sam (friend)',message:'Can you confirm our dinner tomorrow? I need your answer by tonight.',needsAnswer:true}}]});
    assert.equal(verdicts.find(v=>v.id==='disliked')?.keep,false,'saved typed preference influences real judge');
    assert.equal(verdicts.find(v=>v.id==='unrelated')?.keep,true,'does not suppress unrelated dinner obligation');
   }
   console.log(`Live learning: ${id} passed`);
  }
 } finally {await client.end();await admin.unsafe(`drop schema ${name} cascade`);await admin.end();}
});
