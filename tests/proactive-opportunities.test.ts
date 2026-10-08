import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { refreshOpportunities,listOpportunities,claimOpportunityChecks,deferOpportunityChecks,recordOpportunityFeedback,groundedOpportunity,sourceFromRow,contextNoise,type OpportunityDb,type OpportunitySource,type Opportunity } from '../lib/proactive/opportunities';
import type { OpportunityUpdate } from '../lib/proactive/opportunity-model';
import { selectMorningConversations,type MorningContext } from '../lib/proactive/morning-context';
import { publishOpportunityPass } from '../lib/proactive/morning-jobs';
import { getPreferences,recordFeedback } from '../lib/proactive/engine/store';
import { needsMorningResearchRetry,validateMorningIdeas,type MorningReport } from '../lib/proactive/morning-ideas';
import { createTemporalContext } from '../lib/temporal';
const owner='goals@example.invalid',other='other@example.invalid',now=new Date('2026-10-05T10:00:00Z');
const id='00000000-0000-4000-8000-000000000001';
const update:OpportunityUpdate={basis:'explicit_request',supportingEvidence:[],topicKey:'folding-treadmill',kind:'goal',status:'open',title:'Find a running treadmill',summary:'The user still needs a folding treadmill suitable for running.',category:'shopping',sourceRunId:id,quote:'Find a folding treadmill that is good for running',nextCheckAt:now.toISOString(),validUntil:null,deadlineKind:'none',deadlineQuote:null,requiredChange:'Check actual suitable models and stock, rather than infer a running club preference.',reopen:false};
function adapt(db:any):OpportunityDb{return {execute:async(q:any)=>(await db.execute(q)).rows,transaction:async(fn:any)=>db.transaction((tx:any)=>fn(adapt(tx)))} as OpportunityDb;}
async function setup(){const pg=new PGlite(),db=adapt(drizzle(pg));await pg.exec(await readFile('db/migrations/0036_proactive_opportunities.sql','utf8'));await pg.exec(`
 create table app_feature_flags(key text primary key,value jsonb,revision int default 0);
 insert into app_feature_flags values('daily_proactive','{"mode":"everyone","users":[]}',0);
 create table agent_runs(id uuid primary key,user_id text,title text,request text,response text,status text,metadata jsonb,result jsonb,created_at timestamptz,updated_at timestamptz,decision_id text);
 create table agent_messages(run_id uuid,seq int,message jsonb,created_at timestamptz);
 create table user_life_profiles(owner_email text,time_zone text);
 create table scheduled_tasks(owner_email text,status text,definition jsonb,next_run_at timestamptz);
 create table workspace_states(owner_email text primary key,state_json jsonb,preferences_json jsonb default '{}',version int default 1,updated_at timestamptz default now());
 create table proactive_candidates(id uuid default gen_random_uuid(),owner_email text,kind text,dedupe_key text,status text,decision_id text,title text,body text,reason text,payload jsonb,expires_at timestamptz,unique(owner_email,dedupe_key));
 create table push_notification_jobs(id uuid default gen_random_uuid(),owner_email text,decision_id text,title text,subtitle text,body text,status text,unique(owner_email,decision_id));
 create table proactive_preferences(owner_email text primary key,muted_senders jsonb default '[]',muted_topics jsonb default '[]',category_feedback jsonb default '{}',updated_at timestamptz default now());
`);await db.execute(sql`insert into agent_runs values(${id}::uuid,${owner},'Treadmill',${update.quote},'Could not find a suitable one yet.','done','{"sourceType":"manual"}', '{"outcome":"needs_user","verified":true}','2026-09-01','2026-09-01',null)`);for(const email of [owner,other])await db.execute(sql`insert into workspace_states(owner_email,state_json) values(${email},'{"decisions":[],"tasks":[],"history":[],"discardedDecisionIds":[]}'::jsonb)`);return {pg,db};}
const source:OpportunitySource={id,title:'Treadmill',sourceType:'manual',status:'done',request:update.quote,outcome:'No suitable option yet',result:{outcome:'needs_user',verified:true},createdAt:'2026-09-01T10:00:00Z',updatedAt:'2026-09-01T10:00:00Z',userTurns:[{text:update.quote,at:'2026-09-01T10:00:00Z'}]};
test('persistent leads outlive chat recency, classify each source revision once, and isolate owners',async()=>{
 const {pg,db}=await setup();let calls=0;const extract=async()=>{calls++;return [update];};
 assert.equal((await refreshOpportunities(owner,{db,now,extract})).saved,1);
 assert.equal((await listOpportunities(other,db)).length,0);
 assert.equal((await refreshOpportunities(owner,{db,now:new Date(now.getTime()+1000),extract})).processed,0);
 assert.equal(calls,1);
 const [lead]=await listOpportunities(owner,db);assert.equal(lead.status,'open');assert.deepEqual(lead.sourceRunIds,[id]);
 const noise={id:'noise',request:'Do todays Wordle',updatedAt:'2026-10-05',status:'done'};
 const selected=selectMorningConversations([noise,{id,request:update.quote,updatedAt:source.updatedAt,status:'done'}],[lead],[lead],now);assert.deepEqual(selected.map(x=>x.id),[id]);
 const claimed=await claimOpportunityChecks(owner,now,db);assert.equal(claimed.length,1);assert.equal((await claimOpportunityChecks(owner,now,db)).length,0);
 await deferOpportunityChecks(owner,claimed,[{ref:lead.ref,nextCheckAt:'2026-11-01T10:00:00Z',requiredChange:'Only check stock again near the planned purchase.'}],now,db);
 assert.equal((await claimOpportunityChecks(owner,new Date('2026-10-06T10:00:00Z'),db)).length,0);
 assert.equal((await claimOpportunityChecks(owner,new Date('2026-11-02T10:00:00Z'),db)).length,1);
 await pg.close();
});
test('unverified completion, invented evidence, tests and old quotes cannot fulfil or reopen a lead',()=>{
 assert.equal(groundedOpportunity({...update,quote:'I love running clubs and want to join one'},[source],[],now),null);
 assert.equal(groundedOpportunity({...update,status:'fulfilled',nextCheckAt:null},[source],[],now),null);
 assert.equal(contextNoise('Do todays wordle'),true);assert.equal(contextNoise('Find an outdoor wordle tournament'),false);
 const old={ref:'opportunity:folding-treadmill',topicKey:update.topicKey,status:'declined',closedAt:'2026-10-02',sourceRunIds:[id],evidence: {sourceRunId:id,quote:update.quote,quoteAt:source.createdAt}} as Opportunity;
 assert.equal(groundedOpportunity({...update,reopen:true},[source],[old],now),null);
 const newer={...source,userTurns:[{text:update.quote,at:'2026-10-04T10:00:00Z'}]};assert.ok(groundedOpportunity({...update,reopen:true},[newer],[old],now));
 assert.equal(groundedOpportunity({...update,nextCheckAt:'not a date'},[source],[],now),null);
});
test('feature access is checked before extraction, claims, and commit after a flag change',async()=>{
 const {pg,db}=await setup();await db.execute(sql`update app_feature_flags set value='{"mode":"none","users":[]}'::jsonb`);
 let called=false;await refreshOpportunities(owner,{db,now,extract:async()=>{called=true;return [update];}});assert.equal(called,false);assert.deepEqual(await claimOpportunityChecks(owner,now,db),[]);
 await db.execute(sql`update app_feature_flags set value='{"mode":"everyone","users":[]}'::jsonb`);
 await assert.rejects(refreshOpportunities(owner,{db,now,extract:async()=>{await db.execute(sql`update app_feature_flags set value='{"mode":"none","users":[]}'::jsonb`);return [update];}}),/access was disabled/);
 assert.equal((await listOpportunities(owner,db)).length,0);assert.equal((await db.execute(sql`select * from proactive_opportunity_sources`)).length,0);
 await pg.close();
});
function report(ref:string):MorningReport{return {model:'test',serviceTier:'default',localDate:'2026-10-05',audit:[],usages:[],durationMs:0,warnings:[],withheld:[],ideas:[{topicKey:update.topicKey,title:'Treadmill stock',body:'I can compare the available options.',category:'shopping',personalReason:'The requested purchase is unresolved.',personalRefs:[ref],sourceUrls:[],whyNow:'New suitable stock is available.',expiresAt:new Date(Date.now()+86400000).toISOString(),primary:{label:'Compare models',intent:'Compare suitable models',actionType:'research'},alternative:{label:'Not now',intent:'Leave this for later',actionType:'no_action'}}],opportunityChecks:[{ref,nextCheckAt:new Date(Date.now()+7*86400000).toISOString(),requiredChange:'Only offer fresh suitable stock or a new user request.'}]};}
test('publication is atomic and idempotent, and newer negative feedback fences a stale researcher',async()=>{
 const {pg,db}=await setup();await refreshOpportunities(owner,{db,now,extract:async()=>[update]});const checked=await claimOpportunityChecks(owner,now,db),r=report(checked[0].ref);
 assert.equal((await publishOpportunityPass(owner,r,checked,db)).published,1);assert.equal((await publishOpportunityPass(owner,r,checked,db)).published,0);
 assert.equal((await db.execute(sql`select * from push_notification_jobs`)).length,1);
 const [lead]=await listOpportunities(owner,db);assert.equal(lead.lastOffer?.body,r.ideas[0].body);
 await recordFeedback(owner,{kind:'dismissed',category:'shopping'},db);await recordOpportunityFeedback(owner,lead.lastOffer!.decisionId,'dismissed',db);
 assert.equal((await getPreferences(owner,db)).categoryFeedback.shopping.no,1);assert.equal((await listOpportunities(owner,db))[0].status,'waiting');
 await recordOpportunityFeedback(owner,lead.lastOffer!.decisionId,'less_like_this',db);assert.equal((await listOpportunities(owner,db))[0].status,'declined');assert.equal((await publishOpportunityPass(owner,r,checked,db)).published,0);
 assert.equal((await db.execute(sql`select * from push_notification_jobs`)).length,1);
 assert.equal((await db.execute<{state_json:{decisions:unknown[]}}>(sql`select state_json from workspace_states where owner_email=${other}`))[0].state_json.decisions.length,0);
 await pg.close();
});
test('research breadth counts different personal leads, not repeated searches, and deferred leads cannot ground an offer',()=>{
 const lead={ref:'opportunity:folding-treadmill',topicKey:update.topicKey,due:true,status:'open',lastOffer:{topicKey:update.topicKey,whyNow:'Old stock'},sourceRunIds:[id]} as Opportunity & {due:boolean};
 const context={temporal:createTemporalContext('America/Toronto',now),opportunities:[lead],conversations:[{ref:'chat:other',sourceType:'manual'}],facts:[],calendar:[],existing:[]} as unknown as MorningContext;
 const searches=[{tool:'web_search_exa',ok:true,input:{personalAnchorRef:lead.ref}},{tool:'web_search_exa',ok:true,input:{personalAnchorRef:lead.ref}}];
 assert.equal(needsMorningResearchRetry(context,0,searches),true);assert.equal(needsMorningResearchRetry(context,0,[...searches,{tool:'web_search_exa',ok:true,input:{personalAnchorRef:'chat:other'}}]),false);
 const idea=report(lead.ref).ideas[0];idea.expiresAt='2026-10-06T10:00:00Z';
 assert.equal(validateMorningIdeas([idea],context,new Set(),[]).accepted.length,1);
 assert.equal(validateMorningIdeas([idea],{...context,opportunities:[{...lead,due:false}]},new Set(),[]).accepted.length,0);
});
test('deleting source data during model work fences cached memory and leaves no derived records',async()=>{
 const {pg,db}=await setup();await assert.rejects(refreshOpportunities(owner,{db,now,extract:async()=>{await db.execute(sql`delete from agent_runs where user_id=${owner}`);return [update];}}),/source changed or was deleted/);
 assert.equal((await listOpportunities(owner,db)).length,0);assert.equal((await db.execute(sql`select * from proactive_opportunity_sources`)).length,0);await pg.close();
});
test('time-bound goals expire without being counted as fulfilled or a negative preference',async()=>{
 const {pg,db}=await setup();await db.execute(sql`update agent_runs set request=request||' Only before October 5 at noon; do not bother after that.' where id=${id}::uuid`);
 await refreshOpportunities(owner,{db,now,extract:async()=>[{...update,validUntil:'2026-10-05T12:00:00Z',deadlineKind:'hard_deadline',deadlineQuote:'Only before October 5 at noon; do not bother after that.'}]});
 assert.equal((await claimOpportunityChecks(owner,new Date('2026-10-06T10:00:00Z'),db)).length,0);
 assert.equal((await listOpportunities(owner,db))[0].status,'expired');assert.equal((await getPreferences(owner,db)).categoryFeedback.shopping,undefined);await pg.close();
});

test('generated proactive execution prompts never masquerade as user-authored evidence',()=>{
 const row=sourceFromRow({id,title:'Offer',sourceType:'proactive',status:'done',request:'I love running clubs and want to join one',chosenOption:'Compare models',createdAt:source.createdAt,updatedAt:source.updatedAt,messages:[{message:{role:'user',content:'I love running clubs and want to join one\n\nTemporal context: {}'},createdAt:source.createdAt}]});
 assert.equal(row.request,'');assert.ok(row.userTurns.every(turn=>turn.text==='Compare models'&&!turn.authored));
 assert.equal(groundedOpportunity({...update,quote:'I love running clubs and want to join one'},[row],[],now),null);
});
test('recurring purchases need multiple independent completed writes, not searches, copies or an invented confirmation',()=>{
 const first={...source,id:'00000000-0000-4000-8000-000000000005',request:'Order three bags of SmartSweets.',outcome:'Order FIVE is confirmed for three bags of SmartSweets.',result:{outcome:'completed',verified:true,externalChange:true},createdAt:'2026-09-01T10:00:00Z',userTurns:[{text:'Order three bags of SmartSweets.',at:'2026-09-01T10:00:00Z'}]};
 const second={...first,id:'00000000-0000-4000-8000-000000000006',outcome:'Order SIX is confirmed for three bags of SmartSweets.',createdAt:'2026-09-22T10:00:00Z',userTurns:[{text:first.request,at:'2026-09-22T10:00:00Z'}]};
 const support=[first,second].map(s=>({sourceRunId:s.id,quote:s.request,resultQuote:s.outcome}));
 const pattern:OpportunityUpdate={...update,topicKey:'smartsweets-orders',kind:'routine',basis:'repeated_purchase',sourceRunId:second.id,quote:second.request,supportingEvidence:support};
 assert.ok(groundedOpportunity(pattern,[first,second],[],now));
 assert.equal(groundedOpportunity({...pattern,supportingEvidence:[support[1]]},[first,second],[],now),null);
 assert.equal(groundedOpportunity({...pattern,supportingEvidence:[support[1],support[1]]},[first,second],[],now),null);
 assert.equal(groundedOpportunity(pattern,[first,{...second,result:{...second.result,externalChange:false}}],[],now),null);
 assert.equal(groundedOpportunity(pattern,[first,{...second,createdAt:first.createdAt}],[],now),null);
 assert.equal(groundedOpportunity({...pattern,supportingEvidence:[support[0],{...support[1],resultQuote:'Invented order confirmation'}]},[first,second],[],now),null);
});
test('attempt windows do not expire the underlying goal; hard deadlines require quoted evidence',()=>{
 const text='Get me a steak tonight';
 const meal={...source,request:text,userTurns:[{text,at:'2026-10-04T22:00:00Z'}]};
 const attempt={...update,quote:text,summary:'The steak request remains unresolved because the venues were closed.',deadlineKind:'attempt_window' as const,nextCheckAt:'2026-10-05T17:00:00Z'};
 assert.ok(groundedOpportunity(attempt,[meal],[],now));
 assert.equal(groundedOpportunity({...attempt,validUntil:'2026-10-04T23:59:00Z'},[meal],[],now),null);
 const hard='Only before October 5 at noon; do not bother after that.';
 const fixed={...meal,userTurns:[{text:text+'. '+hard,at:meal.createdAt}]};
 const bounded=groundedOpportunity({...attempt,deadlineKind:'hard_deadline',deadlineQuote:hard,validUntil:'2026-10-05T12:00:00Z',nextCheckAt:'2026-10-08T12:00:00Z'},[fixed],[],now)!;
 assert.equal(bounded.nextCheckAt,'2026-10-05T11:30:00.000Z');
 assert.equal(groundedOpportunity({...attempt,deadlineKind:'hard_deadline',deadlineQuote:'An invented deadline',validUntil:'2026-10-05T12:00:00Z'},[meal],[],now),null);
});
test('authored follow-ups in proactive or email-origin chats can create new goals; generated openings and runtime turns cannot',()=>{
 const text='Help me plan a Montreal trip for November 5';
 for(const sourceType of ['proactive','email','unknown']) {
  const row=sourceFromRow({id,title:'Original offer',sourceType,status:'done',request:'A generated hobby recommendation',chosenOption:'Check options',firstUserSeq:1,createdAt:source.createdAt,updatedAt:now.toISOString(),messages:[
   {seq:1,message:{role:'user',content:'A generated hobby recommendation\n\nTemporal context: {}'},createdAt:source.createdAt},
   {seq:2,message:{role:'user',content:text},createdAt:'2026-10-05T09:00:00Z'},
   {seq:3,message:{role:'user',content:'[runtime] internal instruction'},createdAt:'2026-10-05T09:01:00Z'},
  ]});
  assert.equal(row.request,text);assert.ok(groundedOpportunity({...update,quote:text,topicKey:'montreal-future-plan'},[row],[],now));
  assert.equal(groundedOpportunity({...update,quote:'Check options'},[row],[],now),null);
 }
});
test('incremental refresh admits a real user reply in a nonmanual-origin conversation',async()=>{
 const {pg,db}=await setup();await db.execute(sql`update agent_runs set metadata='{"sourceType":"proactive","chosenOption":"Check options"}'::jsonb,request='A generated hobby recommendation' where id=${id}::uuid`);
 const text='Find a folding treadmill that is good for running';
 await db.execute(sql`insert into agent_messages values(${id}::uuid,1,'{"role":"user","content":"A generated hobby recommendation\\n\\nTemporal context: {}"}'::jsonb,'2026-09-01'),(${id}::uuid,2,${JSON.stringify({role:'user',content:text})}::jsonb,'2026-10-04')`);
 const saved=await refreshOpportunities(owner,{db,now,extract:async()=>[update]});assert.equal(saved.saved,1);assert.equal((await listOpportunities(owner,db))[0].evidence.quote,text);await pg.close();
});
test('a genuinely repeated request after closure uses the newest authored quote, not its earlier identical wording',()=>{
 const old={ref:'opportunity:folding-treadmill',topicKey:update.topicKey,kind:'goal',status:'declined',closedAt:'2026-10-02',sourceRunIds:[id],evidence:{sourceRunId:id,quote:update.quote,quoteAt:source.createdAt},lastOffer:{decisionId:'old-offer'}} as Opportunity;
 const next={...source,sourceType:'proactive',decisionId:'old-offer',userTurns:[{text:update.quote,at:source.createdAt,authored:true},{text:update.quote,at:'2026-10-04T10:00:00Z',authored:true}]};
 assert.equal(groundedOpportunity({...update,reopen:true},[next],[old],now)?.evidence.quoteAt,'2026-10-04T10:00:00Z');
});
