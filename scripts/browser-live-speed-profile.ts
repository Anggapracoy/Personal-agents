/** One real-site speed diagnosis, with production cloud transport and isolated run storage. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
const url=process.env.COMPARISON_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1')throw new Error('Isolated local database required');
process.env.DATABASE_URL=url;delete process.env.INNGEST_EVENT_KEY;
const root=process.env.COMPARISON_OUTPUT_DIR!;mkdirSync(root,{recursive:true});
const sql=postgres(url,{max:1,onnotice:()=>{}});
await sql`create table if not exists benchmark_migrations (name text primary key)`;
for(const file of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort()){
 if((await sql`select name from benchmark_migrations where name=${file}`).length)continue;
 await sql.unsafe(readFileSync(`db/migrations/${file}`,'utf8'));
 await sql`insert into benchmark_migrations values (${file})`;
}
const {defaultAgentModelSettings,agentModelMetadata}=await import('../lib/agent-model-settings');
const {PostgresRunStore}=await import('../lib/harness/store');
const {createAgentModel}=await import('../lib/harness/model');
const {runAgent}=await import('../lib/harness/run');
const {closeCloudBrowser}=await import('../lib/harness/browser/registry');
const {modelCassette}=await import('./benchmarks/model-cassette');
const cassette=modelCassette();
const prompt=process.env.BROWSER_ONE_SHOT === '1' ? 'Open the white LAGKAPTEN / ADILS desk product at IKEA, verify its current displayed price and dimensions, and capture desk-measurements.png. One read-only browser session; no login, cart, or submission. Fixed script without a model call.' : 'Use the browser to research real products at https://www.ikea.com/us/en/cat/desks-computer-desks-20649/. Find two different desk models costing no more than $150 USD each, width 35 to 48 inches inclusive. Open each individual product page and verify selected finish/size, current displayed price, width and depth, and the exact availability or delivery wording shown. Do not infer stock from a purchase button or enter a ZIP code. Compute the surface area and price per square foot, and recommend the larger surface, breaking ties by lower price. Cite the actual product-page URLs and short evidence quotes. Capture a screenshot named winning-desk.png of the recommended product. Use browser tools for all research; do not use external search, fetch APIs, or sandbox tools. Do not log in, add to cart, purchase, submit personal information, or change any account. If blocked or fewer than two can be verified, report exactly what you verified and the blocker. This is read-only research.';
const files=['lib/harness/model.ts','lib/harness/browser/cloud.ts','lib/harness/browser/cloud-controller.ts',...(process.env.BROWSER_COLOCATION_PROBE==='1'?['scripts/browser-colocation-profile.ts']:[])];
writeFileSync(`${root}/protocol.json`,JSON.stringify({settings:defaultAgentModelSettings,prompt,diagnosticTemplate:process.env.BROWSER_COLOCATION_TEMPLATE_ID ?? null,scope:process.env.BROWSER_COLOCATION_PROBE==='1' ? 'Diagnostic colocation: Chromium and controller in one E2B VM, guarded browser tools, local PostgreSQL and Node harness. Profiles, live viewer, CAPTCHA service and Browserless proxy are unavailable. Includes cold startup; excludes evaluator setup, UI/scheduler and cleanup. Not production parity.' : 'One live IKEA task. Production Browserless/E2B controller, local PostgreSQL, local Node harness. Includes cold browser startup; excludes evaluator setup, UI/scheduler and cleanup. Diagnostic wrappers add some overhead.',hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]))},null,2));
const store=new PostgresRunStore(url);
const run=await store.createRun({userId:`live-speed-${crypto.randomUUID()}@example.invalid`,decisionId:null,category:'evaluation',title:'Live IKEA browser speed diagnosis',request:prompt,metadata:{...agentModelMetadata(defaultAgentModelSettings),userTimeZone:'America/Toronto'}});
const started=performance.now();const startedAt=Date.now();
const steps:unknown[]=[];
const model=process.env.BROWSER_REPLAY_MESSAGES
 ? (await import('./browser-live-trace-replay')).browserTraceReplay(store,process.env.BROWSER_REPLAY_MESSAGES,root)
 : createAgentModel(store,{useGlobalSettings:false,onModelStep:s=>steps.push(s)});
const timer=setInterval(async()=>{const s=await store.getSnapshot(run.id);console.log('PROGRESS',Math.round((performance.now()-started)/1000),s?.status,s?.actions.length,s?.actions.at(-1)?.toolName)},15000);
let thrown:string|null=null;
try{
 try{await runAgent({store,runId:run.id,model,signal:AbortSignal.timeout(600000),sliceMs:600000})}catch(e){thrown=String(e)}
 const elapsedMs=performance.now()-started;clearInterval(timer);
 const snapshot=(await store.getSnapshot(run.id))!;
 writeFileSync(`${root}/result.json`,JSON.stringify({runId:run.id,startedAt,elapsedMs,thrown,settings:defaultAgentModelSettings,status:snapshot.status,error:snapshot.error,response:snapshot.response,actions:snapshot.actions,metadata:snapshot.metadata,steps},null,2));
 writeFileSync(`${root}/messages.json`,JSON.stringify(await store.listMessages(run.id),null,2));
 for(const a of snapshot.artifacts){const f=await store.getArtifact(a.id,run.id);if(f)writeFileSync(`${root}/${a.name.replaceAll('/','_')}`,Buffer.from(f.bytesBase64,'base64'))}
 console.log('RESULT',JSON.stringify({elapsedMs,status:snapshot.status,error:snapshot.error,thrown,actions:snapshot.actions.length,response:snapshot.response}));
}finally{
 clearInterval(timer);
 try{await closeCloudBrowser(run.userId);writeFileSync(`${root}/cleanup.json`,JSON.stringify({browserClosed:true}))}catch(e){writeFileSync(`${root}/cleanup.json`,JSON.stringify({browserClosed:false,error:String(e)}))}
 await store.sql.end();await sql.end();await cassette.finish();
}
process.exit(0);
