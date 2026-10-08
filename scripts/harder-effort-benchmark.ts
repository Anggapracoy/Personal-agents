/** Configurable model/effort benchmark: production Dash harness, deterministic sources and real local Chrome. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
const databaseUrl=process.env.COMPARISON_DATABASE_URL;
if(!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1') throw new Error('Isolated localhost database required');
process.env.DATABASE_URL=databaseUrl; for(const key of ['INNGEST_EVENT_KEY','BROWSERLESS_API_TOKEN','E2B_API_KEY']) delete process.env[key];
const db=postgres(databaseUrl,{max:1});
await db`create table if not exists benchmark_migrations (name text primary key)`;
for(const f of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort()) {
 if((await db`select name from benchmark_migrations where name=${f}`).length)continue;
 await db.unsafe(readFileSync(`db/migrations/${f}`,'utf8'));
 await db`insert into benchmark_migrations values (${f})`;
}
const {createAgentModel}=await import('../lib/harness/model');
const {runAgent}=await import('../lib/harness/run');
const {PostgresRunStore}=await import('../lib/harness/store');
const {localBrowser}=await import('./benchmarks/local-browser');
const {harderCases:cases}=await import('./benchmarks/harder-cases');
type Case=typeof cases[number];
const {costMicrousd}=await import('./benchmarks/model-cost');
const root=process.env.EVAL_OUTPUT_ROOT??'/tmp/dash-harder-effort'; mkdirSync(root,{recursive:true});
const messages:Record<string,any>={};
for(const c of cases)for(const [id,doc] of Object.entries(c.documents))messages[id]={id,threadId:id,payload:{mimeType:'text/plain',headers:[{name:'Subject',value:id},{name:'From',value:'fixture@example.invalid'}],body:{data:Buffer.from(JSON.stringify(doc)).toString('base64url')}}};
let current:Case;const sourceReads:string[]=[];const apiRequests:any[]=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(['api.openai.com','api.anthropic.com'].includes(u.hostname)) {
  const body=typeof init?.body==='string'?JSON.parse(init.body):{};
  apiRequests.push({model:body.model,reasoning:body.reasoning??body.output_config,thinking:body.thinking,cache:body.prompt_cache_options??body.cache_control});
  return originalFetch(input,init);
 }
 if(u.hostname==='127.0.0.1')return originalFetch(input,init);
 if((init?.method??'GET')!=='GET')throw new Error('Fixture blocks all external mutations');
 if(u.hostname==='gmail.googleapis.com'){
  if(u.pathname.endsWith('/labels/INBOX'))return Response.json({id:'INBOX',messagesUnread:0,threadsUnread:0});
  const id=decodeURIComponent(u.pathname.split('/messages/')[1]??'');sourceReads.push(id||'gmail-search');
  if(!id){
   const query=(u.searchParams.get('q')??'').toLowerCase();
   const terms=query.match(/(?:[^\s"]+|"[^"]*")+/g)??[];
   const keys=Object.keys(current.documents);
   const matched=keys.filter(k=>{const m=messages[k],subject=m.payload.headers.find((h:any)=>h.name==='Subject')!.value.toLowerCase();const hay=[k,subject,Buffer.from(m.payload.body.data,'base64url').toString()].join(' ').toLowerCase();return terms.every(raw=>{const neg=raw.startsWith('-'),term=(neg?raw.slice(1):raw).replaceAll('\"','');const found=term.startsWith('subject:')?(subject+' '+k).includes(term.slice(8)):hay.includes(term);return neg?!found:found})});
   return Response.json({messages:matched.slice(0,Number(u.searchParams.get('maxResults')??10)).map(id=>({id,threadId:id}))});
  }
  return Response.json(messages[id]??{error:{message:'Unknown fixture message'}},{status:messages[id]?200:404});
 }
 throw new Error(`Fixture blocks external host ${u.hostname}`);
};
function parseAnswer(response:string){const a=response.indexOf('{'),b=response.lastIndexOf('}');try{return JSON.parse(response.slice(a,b+1))}catch{return null}}
function equal(a:any,b:any):boolean{if(Array.isArray(b))return Array.isArray(a)&&a.length===b.length&&(b.every(x=>typeof x==='string')?b.every(x=>a.includes(x)):b.every((x,i)=>equal(a[i],x)));if(b&&typeof b==='object')return a&&Object.entries(b).every(([k,v])=>equal(a[k],v));return typeof b==='number'?typeof a==='number'&&Math.abs(a-b)<0.001:a===b;}
const models=['gpt-6.1-sol'].filter(id=>!process.env.EVAL_MODELS||process.env.EVAL_MODELS.split(',').includes(id));
const efforts=(process.env.EVAL_EFFORTS??'low,medium').split(',');
if(efforts.some(e=>!['low','medium'].includes(e)))throw new Error('EVAL_EFFORTS supports low,medium');
const variants=models.flatMap(modelId=>efforts.map(effort=>({modelId,effort})));

writeFileSync(`${root}/fixtures.json`,JSON.stringify({cases:cases.map(({browser,...c})=>({...c,browserUrl:browser?.url})),messages,protocol:{reasoning:efforts,repetitions:1,order:'rotated per task',timeoutMs:480000,standardTier:true}},null,2));
const rows:any[]=[];
for(const [index,test] of cases.entries())for(const {modelId,effort} of [...variants.slice(index%variants.length),...variants.slice(0,index%variants.length)]) {
 const variantId=process.env.EVAL_EFFORTS?`${modelId}-${effort}`:modelId;
 if(process.env.EVAL_CASES&&!process.env.EVAL_CASES.split(',').includes(test.id))continue;
 if(process.env.EVAL_MODELS&&!process.env.EVAL_MODELS.split(',').includes(modelId))continue;
 current=test;sourceReads.length=0;apiRequests.length=0;
 const store=new PostgresRunStore(databaseUrl);const steps:any[]=[];const attempted:any[]=[];
 const run=await store.createRun({userId:`hard-benchmark-${crypto.randomUUID()}@example.invalid`,decisionId:null,category:'evaluation',title:test.id,request:test.request,metadata:{modelProvider:modelId.startsWith('claude')?'anthropic':'openai',modelId,reasoningEffort:effort,userTimeZone:'America/Toronto'}});
 if(!test.browser)await store.putSecret(run.id,'google_access_token','synthetic-token');
 const browser=test.browser?await localBrowser(run.userId,run.id,test.browser):null;
 const started=performance.now();console.log('START',test.id,variantId);
 const timer=setInterval(async()=>{const s=await store.getSnapshot(run.id);console.log('PROGRESS',test.id,variantId,Math.round((performance.now()-started)/1000),s?.status,s?.actions.length,s?.actions.at(-1)?.toolName)},15000);
 let error:string|null=null;
 try {
 await runAgent({store,runId:run.id,model:createAgentModel(store,{useGlobalSettings:false,onRawToolInput:(name,input)=>attempted.push({name,input}),onModelStep:step=>steps.push(step)}),signal:AbortSignal.timeout(480000),sliceMs:480000});
 }catch(e){error=String(e)}finally{clearInterval(timer)}
 const elapsedMs=performance.now()-started;const s=(await store.getSnapshot(run.id))!;
 const usage=steps.reduce((a,r)=>({input:a.input+(r.usage.inputTokens??0),output:a.output+(r.usage.outputTokens??0),reasoning:a.reasoning+(r.usage.outputTokenDetails.reasoningTokens??0),cacheRead:a.cacheRead+(r.usage.inputTokenDetails.cacheReadTokens??0),cacheWrite:a.cacheWrite+(r.usage.inputTokenDetails.cacheWriteTokens??0)}),{input:0,output:0,reasoning:0,cacheRead:0,cacheWrite:0});
 // Persist measurements before pricing so incomplete provider usage cannot erase the trace.
 writeFileSync(`${root}/${test.id}-${variantId}-measurement.json`,JSON.stringify({elapsedMs,steps,snapshot:s},null,2));
 const usageComplete=steps.every(r=>Number.isSafeInteger(r.usage.inputTokens)&&Number.isSafeInteger(r.usage.outputTokens));
 const costUSD=usageComplete?steps.reduce((sum,r)=>sum+costMicrousd(modelId,{inputTokens:{total:r.usage.inputTokens,cacheRead:r.usage.inputTokenDetails.cacheReadTokens,cacheWrite:r.usage.inputTokenDetails.cacheWriteTokens},outputTokens:{total:r.usage.outputTokens}})/1e6,0):null;
 const answer=parseAnswer(s.response);const checks=Object.fromEntries(Object.entries(test.expected).map(([k,v])=>[k,equal(answer?.[k],v)]));
 checks.toolScope=s.actions.every(a=>test.browser?(a.toolName.startsWith('browser_')||a.toolName==='inspect_artifact'):['gmail_search_messages','gmail_read_message'].includes(a.toolName));
 checks.done=s.status==='done';
 if(!test.browser)checks.sourceCoverage=Object.keys(test.documents).every(id=>sourceReads.includes(id));
 let observed:any=null;
 if(browser){
  observed=await browser.page.evaluate(()=>({url:location.href,review:JSON.parse(sessionStorage.getItem('review')||'null'),tickets:JSON.parse(sessionStorage.getItem('tickets')||'null'),trip:JSON.parse(sessionStorage.getItem('trip')||'null'),submitted:sessionStorage.getItem('submitted'),sent:sessionStorage.getItem('sent'),stockChanged:sessionStorage.getItem('stockChanged'),failedSave:sessionStorage.getItem('failedSave'),revalidated:sessionStorage.getItem('revalidated')}));
  let actual:any=observed.review??observed.trip??observed;
  if(test.id==='browser-stock-recovery'){
   checks.stockChanged=observed.stockChanged==='true';
   actual={...actual,cart:actual?.cart?.slice().sort((a:any,b:any)=>a.sku.localeCompare(b.sku))};
  }
  if(test.id==='browser-travel-revalidation')actual={...actual,revalidated:observed.revalidated};
  for(const [k,v]of Object.entries(test.stateExpected??{}))checks['state.'+k]=equal(actual?.[k],v);
  if(test.id==='browser-support-drafts'){
   checks.refundNote=/20/.test(observed.tickets?.[0]?.note??'')&&/settled/i.test(observed.tickets?.[0]?.note??'');
   checks.pendingNote=/pending/i.test(observed.tickets?.[1]?.note??'');
  }
  checks.notSubmitted=observed.submitted!=='true'&&observed.sent!=='true';
  checks.screenshot=s.artifacts.some(a=>a.name==='final-review.png');
  await browser.page.screenshot({path:`${root}/${test.id}-${variantId}.png`,fullPage:true});
 }
 const toolCounts:Record<string,number>={};for(const a of s.actions)toolCounts[a.toolName]=(toolCounts[a.toolName]??0)+1;
 const row={task:test.id,modelId,effort,runId:run.id,elapsedMs,costUSD,usage,modelCalls:steps.length,toolCalls:steps.reduce((n,r)=>n+Object.keys(r.performance?.toolExecutionMs??{}).length,0),toolActions:s.actions.length,toolCounts,failedActions:s.actions.filter(a=>a.status!=='executed').length,status:s.status,error:s.error??error,response:s.response,answer,checks,passed:Object.values(checks).every(Boolean),steps,attempted,sourceReads:[...sourceReads],apiRequests:[...apiRequests],actions:s.actions,observed,browserTimings:browser?.timings};
 rows.push(row);writeFileSync(`${root}/results.json`,JSON.stringify(rows,null,2));writeFileSync(`${root}/${test.id}-${variantId}.json`,JSON.stringify({row,messages:await store.listMessages(run.id)},null,2));
 console.log('RESULT',JSON.stringify({task:test.id,modelId,effort,seconds:elapsedMs/1000,costUSD,passed:row.passed,checks,modelCalls:steps.length,toolCalls:steps.reduce((n,r)=>n+Object.keys(r.performance?.toolExecutionMs??{}).length,0),toolActions:s.actions.length,status:s.status,error:row.error}));
 if(browser)await browser.close();await store.sql.end();
}
await db.end();process.exit(0);
