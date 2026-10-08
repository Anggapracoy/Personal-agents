/** Live public form comparison, no submission and no production persistence. */
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import postgres from 'postgres';
const url=process.env.COMPARISON_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1')throw new Error('Isolated local database required');
process.env.DATABASE_URL=url;delete process.env.INNGEST_EVENT_KEY;
const db=postgres(url,{max:1});for(const f of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort())await db.unsafe(readFileSync(`db/migrations/${f}`,'utf8'));await db.end();
const {createAgentModel}=await import('../lib/harness/model');const {runAgent}=await import('../lib/harness/run');const {MemoryRunStore}=await import('../lib/harness/store');const {getCloudBrowser,closeCloudBrowser}=await import('../lib/harness/browser/registry');
const root=process.env.BROWSER_LATENCY_OUTPUT || '/tmp/dash-browser-speed-form';mkdirSync(root,{recursive:true});
const request='Use the cloud browser to open https://www.selenium.dev/selenium/web/web-form.html. Set Text input to the exact literal string "Dash form test". Set Textarea to the exact literal string "Testing without submitting" (all three words are field content). Choose Two in Dropdown (select). Check Default checkbox. Inspect the form again to verify all four values and capture a screenshot named prepared-form.png. Do not fill the password, change any other fields, or click Submit. Briefly report whether all four values were verified and confirm the form was not submitted.';
const fetchOriginal=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(url.startsWith('https://api.openai.com/')&&typeof init?.body==='string'){const body=JSON.parse(init.body);body.service_tier='default';return fetchOriginal(input,{...init,body:JSON.stringify(body)});}return fetchOriginal(input,init);};
const rows=[];
for(const modelId of ['gpt-6-sol']){
 const store=new MemoryRunStore();const run=await store.createRun({userId:`form-eval-${crypto.randomUUID()}@example.invalid`,decisionId:null,category:'evaluation',title:'Simple form',request,metadata:{modelProvider:'openai',modelId,reasoningEffort:'medium',userTimeZone:'America/Toronto'}});
 const started=performance.now();let thrown:string|null=null;
 console.log('START',modelId);
 const timer=setInterval(async()=>{const s=await store.getSnapshot(run.id);console.log('PROGRESS',modelId,Math.round((performance.now()-started)/1000),s?.status,s?.actions.length,s?.actions.at(-1)?.toolName)},15000);
 try{await runAgent({store,runId:run.id,model:createAgentModel(store,{useGlobalSettings:false}),signal:AbortSignal.timeout(240000)});}catch(e){thrown=String(e)}finally{clearInterval(timer)}
 const elapsedMs=performance.now()-started;const s=(await store.getSnapshot(run.id))!;let observed:any=null;let verificationError:string|null=null;
 try{observed=await getCloudBrowser(run.userId,run.id).snapshot();writeFileSync(`${root}/${modelId}-verified.png`,await getCloudBrowser(run.userId,run.id).screenshot());}catch(e){verificationError=String(e)}
 const elements=observed?.elements??[];const find=(name:string)=>elements.find((e:any)=>e.name===name);
 const checks={done:s.status==='done',text:find('Text input')?.value==='Dash form test',textarea:find('Textarea')?.value==='Testing without submitting',dropdown:find('Dropdown (select)')?.value==='2'||find('Dropdown (select)')?.options?.some((o:any)=>o.label==='Two'&&o.selected),checkbox:find('Default checkbox')?.checked===true,unsubmitted:observed?.url==='https://www.selenium.dev/selenium/web/web-form.html'&&!s.actions.some(a=>a.risk==='write_external'&&a.status==='executed'),screenshot:s.artifacts.some(a=>a.mimeType==='image/png')};
 const requests=(s.metadata.openaiRequests??[]) as any[];const costUSD=requests.reduce((t,r)=>t+((r.inputTokens-r.cacheReadTokens-r.cacheWriteTokens)*2+r.cacheReadTokens*.2+r.cacheWriteTokens*2.5+r.outputTokens*(modelId==='gpt-6-sol'?10:12))/1e6,0);
 for(const a of s.artifacts){const data=await store.getArtifact(a.id,s.id);if(data)writeFileSync(`${root}/${modelId}-${a.name.replaceAll('/','_')}`,Buffer.from(data.bytesBase64,'base64'))}
 const modelMs=requests.reduce((sum,r)=>sum+(r.responseTimeMs??0),0);const stepMs=requests.reduce((sum,r)=>sum+(r.stepTimeMs??0),0);const row={modelMs,stepMs,toolShare:stepMs?(stepMs-modelMs)/stepMs:null,modelId,elapsedMs,costUSD,checks,passed:Object.values(checks).every(Boolean),status:s.status,error:s.error,thrown,verificationError,response:s.response,requests,actions:s.actions,observed};rows.push(row);writeFileSync(`${root}/results.json`,JSON.stringify(rows,null,2));writeFileSync(`${root}/${modelId}-messages.json`,JSON.stringify(await store.listMessages(run.id),null,2));console.log('RESULT',JSON.stringify({...row,requests:requests.length,actions:s.actions.map(a=>({tool:a.toolName,status:a.status})),observed:undefined}));
 await closeCloudBrowser(run.userId).catch(e=>console.log('CLEANUP_ERROR',String(e)));
}
process.exit(0);
