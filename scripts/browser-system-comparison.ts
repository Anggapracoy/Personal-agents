/** One isolated production-harness browser run; no production user data writes. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { createAgentModel } from '../lib/harness/model';
import { runAgent } from '../lib/harness/run';
import { MemoryRunStore } from '../lib/harness/store';
import { closeCloudBrowser, getCloudBrowser } from '../lib/harness/browser/registry';

if (!process.env.COMPARISON_DATABASE_URL || new URL(process.env.COMPARISON_DATABASE_URL).hostname !== '127.0.0.1') throw new Error('An isolated local database is required');
process.env.DATABASE_URL = process.env.COMPARISON_DATABASE_URL;
delete process.env.INNGEST_EVENT_KEY;
const db = postgres(process.env.DATABASE_URL, {prepare:false,max:1});
for (const file of readdirSync('db/migrations').filter(file=>file.endsWith('.sql')).sort()) await db.unsafe(readFileSync(`db/migrations/${file}`,'utf8'));
await db.end();
const settings=JSON.parse(readFileSync('/tmp/dash-browser-comparison-settings.json','utf8'));
const folder=process.env.COMPARISON_OUTPUT_DIR || 'artifacts/browser-system-comparison';
mkdirSync(folder,{recursive:true});
const modelInputs: unknown[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
 if (String(url).startsWith('https://api.openai.com/') && typeof init?.body === 'string') {
  const body=JSON.parse(init.body);
  const content=(body.input ?? []).flatMap((message: {content?:unknown[]})=>Array.isArray(message.content)?message.content:[]);
  modelInputs.push(content.flatMap((part: {type?:string;text?:string;image_url?:string})=>part.type==='input_text' && part.text?.startsWith('Runtime browser screenshot') ? [{type:part.type,text:part.text}] : part.type==='input_image' && part.image_url?.startsWith('data:image/png;base64,') ? [{type:part.type,sha256:createHash('sha256').update(Buffer.from(part.image_url.split(',')[1],'base64')).digest('hex')}] : []));
 }
 return originalFetch(url,init);
};
const request='Use only browser tools to open https://www.selenium.dev/selenium/web/web-form.html. Put "Dash browser comparison" in Text input and "Prepared for comparison. Do not submit." in Textarea. Select "Two" in Dropdown (select). Check Default checkbox. Leave every other control unchanged. Verify all four final values, leave the form unsubmitted, capture a screenshot named prepared-form.png, and briefly report the verified values and that you did not submit. Do not use api_fetch or sandbox_run and do not touch personal Chrome.';
writeFileSync(`${folder}/protocol.json`,JSON.stringify({request,settings,scope:'Local current harness code, production model setting, isolated PostgreSQL and MemoryRunStore, synthetic user; one sample per system.'},null,2));
const store=new MemoryRunStore();
const run=await store.createRun({userId:`browser-compare-${crypto.randomUUID()}@example.invalid`,decisionId:null,category:'evaluation',title:'Simple browser comparison',request,metadata:{sourceType:'manual',modelProvider:settings.modelId.startsWith('muse')?'meta':'openai',modelId:settings.modelId,reasoningEffort:settings.reasoningEffort}});
const started=performance.now();
const timer=setInterval(async()=>{const s=await store.getSnapshot(run.id);if(s){writeFileSync(`${folder}/progress.json`,JSON.stringify({elapsedMs:performance.now()-started,status:s.status,actions:s.actions,response:s.response},null,2));console.log('PROGRESS',Math.round((performance.now()-started)/1000),s.status,s.actions.length,s.actions.at(-1)?.toolName);}},15000);
let thrown:string|null=null;
try {
 try {await runAgent({store,runId:run.id,model:createAgentModel(store,{useGlobalSettings:false}),signal:AbortSignal.timeout(240000)});} catch(error){thrown=String(error);} finally {clearInterval(timer);}
 const elapsedMs=performance.now()-started;
 const snapshot=(await store.getSnapshot(run.id))!;
 const messages=await store.listMessages(run.id);
 let page:unknown=null;
 try {page=await getCloudBrowser(run.userId,run.id).snapshot();}catch(error){page={error:String(error)};}
 for(const a of snapshot.artifacts){const file=await store.getArtifact(a.id,run.id);if(file)writeFileSync(`${folder}/${a.name.replaceAll('/','_')}`,Buffer.from(file.bytesBase64,'base64'));}
 const serialized=JSON.stringify(messages);
 const result={settings,elapsedMs,status:snapshot.status,error:snapshot.error,thrown,response:snapshot.response,result:snapshot.result,actions:snapshot.actions,requests:snapshot.metadata.openaiRequests??snapshot.metadata.metaRequests,persistedImageParts:(serialized.match(/"type":"(?:image|image-data|image-url)"/g)??[]).length,modelInputs,artifacts:snapshot.artifacts,finalPage:page};
 writeFileSync(`${folder}/result.json`,JSON.stringify(result,null,2));
 writeFileSync(`${folder}/messages.json`,JSON.stringify(messages,null,2));
 console.log('RESULT',JSON.stringify({settings,elapsedMs,status:result.status,error:result.error,thrown,response:result.response,actions:result.actions.map(a=>({tool:a.toolName,status:a.status})),capturedModelInputs:modelInputs.length}));
} finally {await closeCloudBrowser(run.userId);}
process.exit(0);
