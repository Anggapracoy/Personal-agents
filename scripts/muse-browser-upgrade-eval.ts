import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
/** Serial, repeated live-browser evaluations. Never touches production run data or global model settings. */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createAgentModel } from '../lib/harness/model';
import { runAgent } from '../lib/harness/run';
import { MemoryRunStore } from '../lib/harness/store';
import { closeCloudBrowser } from '../lib/harness/browser/registry';

if (!process.env.MUSE_TEST_DATABASE_URL || new URL(process.env.MUSE_TEST_DATABASE_URL).hostname !== '127.0.0.1') throw new Error('An isolated localhost test database is required');
process.env.DATABASE_URL = process.env.MUSE_TEST_DATABASE_URL;
delete process.env.INNGEST_EVENT_KEY;
const evaluationAbort = new AbortController();
process.once('SIGTERM',()=>evaluationAbort.abort(new Error('Evaluation interrupted')));
process.once('SIGINT',()=>evaluationAbort.abort(new Error('Evaluation interrupted')));
const root=process.env.MUSE_BROWSER_EVAL_ROOT ?? 'artifacts/muse-browser-upgrade';
const repetitions=process.env.MUSE_BROWSER_REPETITIONS==='1'?1:2;
const tasks: Array<{id:string;prompt:string}>=[
 {id:'ikea', prompt:`Starting at https://www.ikea.com/us/en/cat/desks-computer-desks-20649/, find two different desk models costing no more than $150 USD each, with width at least 35 inches and no more than 48 inches. Open their individual product pages. For each, verify the selected finish/size, current displayed regular or sale price, width and depth, and exact availability or delivery wording shown. Do not infer stock from a generic purchase button or supply a ZIP code. Calculate surface area in square inches and price per square foot using code. Recommend the larger surface area, breaking a tie by lower price. If fewer than two can be verified, give the verified subset and explain the concrete blocker rather than inventing a match. Return findings.products as objects with name, variant, priceUSD, widthInches, depthInches, areaSquareInches, pricePerSquareFoot, availabilityText, url; and findings.winnerUrl. Capture a screenshot of the winning product page.`},
 {id:'acadia', prompt:`Starting at https://www.nps.gov/acad/planyourvisit/index.htm, plan a daytime visit on September 20, 2026 for two US-resident adults in one private passenger car, with no existing passes. They want to enter Acadia and drive Cadillac Summit Road that day. Using official NPS pages, determine the standard vehicle entrance charge and validity period, whether a separate Cadillac vehicle reservation is required on that date, its total price and whether entrance is included, and the reservation release schedule. Compare the total required fees for this single visit with the Acadia annual pass plus the same reservation. Use code for arithmetic. Do not claim a reservation is available merely because the booking page exists. Return findings with visitDate, vehicleEntranceUSD, entranceValidityDays, cadillacReservationRequired, cadillacReservationUSD, reservationIncludesEntrance, releaseSchedule, singleVisitTotalUSD, acadiaAnnualPassUSD, annualOptionTotalUSD, availabilityVerified, and sourceUrls. Cite short exact quotes supporting every price and reservation rule, and capture the official reservation-rules page as a screenshot. Do not reserve anything.`},
 {id:'firefox', prompt:`Starting at https://support.mozilla.org/en-US/topics/installation-and-updates/firefox, research what Mozilla currently recommends for three computers: Windows 7 64-bit, macOS 10.14, and Windows 11 64-bit. Navigate to official Mozilla support or release/system-requirements pages. Distinguish the current regular Firefox release from any recommended ESR branch for older operating systems. For each computer, report whether the current regular release supports it, the recommended Firefox channel/major version if stated, and any support-end date or extension exactly as qualified by the source. Use current live page statements; do not replace them with remembered release dates. If sources conflict, report that explicitly. Do not download or install software. Return findings.computers as objects with os, currentReleaseSupported, recommendedChannel, recommendedMajorVersion, supportEnd, qualification, sourceUrls. Supply exact evidence quotes for support and end-date claims, and capture one authoritative compatibility page as a screenshot.`},
];
if (process.env.MUSE_BROWSER_CAPABILITY_FIXTURE === "1") {
 const {url}=JSON.parse(readFileSync("artifacts/browser-capabilities/fixture.json","utf8"));
 tasks.unshift({id:"capabilities",prompt:`Open ${url}, a disposable browser test fixture. Use scoped role/name targets to search only in the Secondary region for violet, leaving Primary untouched. Then replace the Secondary query with amber and submit it using browser_press Enter. Read that region using targeted browser_inspect. Click Start loading and use browser_wait_for until Loaded result is enabled, then click Hide result and wait until Loaded result is hidden. Hover Details and read its tooltip. Scroll inside Scrollable panel and report the bottom marker. Do not click or press the Send button. Save findings with primaryUntouched, secondaryResult, keyboardSubmitted, loadedThenHidden, tooltip, panelBottom and sentCount, based on observations. Capture a screenshot of the fixture after completing these operations.`});
}
const configs: Array<{provider:'meta'|'openai';modelId:string;effort:'medium'}>=[{provider:'meta',modelId:'muse-spark-1.3',effort:'medium'}];
if(process.env.MUSE_BROWSER_COMPARE_TERRA==='1') configs.push({provider:'openai',modelId:'gpt-5.6-terra',effort:'medium'});
let suffix=`\nUse browser_* tools for all web research and sandbox_run only for calculations and artifact creation, not network requests. Save /workspace/out/findings.json with {findings, evidence}, where evidence is an array of {claim,quote,url} with short verbatim quotes from the pages you actually inspected. Save /workspace/out/report.md with a concise answer, sources, and any uncertainties, plus source.png as a browser_screenshot artifact (it is separate from sandbox files). Return a structured result using present_result with the artifacts and source links; mark verified only when your evidence supports the reported findings. Read-only site searches, tabs and routine cookie notice dismissal are permitted. Do not purchase, book, send messages, log in, or modify any external account. A blocked site or unavailable fact must be reported honestly.`;
if (process.env.MUSE_BROWSER_PROTOCOL_FILE) {
 const protocol = JSON.parse(readFileSync(process.env.MUSE_BROWSER_PROTOCOL_FILE, 'utf8'));
 if (!Array.isArray(protocol.tasks) || !protocol.tasks.length || !protocol.tasks.every((t: {id?: unknown; prompt?: unknown}) => typeof t.id === 'string' && /^[a-z0-9-]+$/.test(t.id) && typeof t.prompt === 'string') || typeof protocol.suffix !== 'string') throw new Error('Invalid evaluation protocol');
 tasks.splice(0, tasks.length, ...protocol.tasks);
 suffix = protocol.suffix;
}
mkdirSync(root,{recursive:true});
writeFileSync(`${root}/code-fingerprint.json`,JSON.stringify(Object.fromEntries(['lib/harness/model.ts','lib/harness/run.ts','lib/harness/actions.ts','lib/harness/tools.ts','lib/harness/browser/cloud.ts','lib/harness/browser/cloud-controller.ts','lib/harness/browser/policy.ts','lib/harness/browser/vision.ts','lib/harness/result-schema.ts','lib/harness/browser/registry.ts'].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),null,2));
writeFileSync(`${root}/protocol.json`,JSON.stringify({tasks:tasks.map(t=>({...t,prompt:t.prompt+suffix})),configs,repetitions,serial:true,timeoutMs:8*60_000,globalModelOverride:false},null,2));
evaluation: for(let repetition=1;repetition<=repetitions;repetition++) for(const task of tasks) for(const config of repetition===1?configs:[...configs].reverse()) {
 if(evaluationAbort.signal.aborted) break evaluation;
 const label=`${task.id}/${config.modelId}-${config.effort}/run-${repetition}`;
 const folder=`${root}/${label}`;
 if(existsSync(`${folder}/result.json`)) continue;
 mkdirSync(folder,{recursive:true});
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:`browser-eval-${crypto.randomUUID()}@example.invalid`,decisionId:null,category:'evaluation',title:label,request:task.prompt+suffix,metadata:{modelProvider:config.provider,modelId:config.modelId,reasoningEffort:config.effort,userTimeZone:'America/Toronto'}});
 const started=performance.now();let thrown:string|null=null;
 const rawInputDiagnostics: Array<Record<string,unknown>>=[];
 const onRawToolInput=(toolName:string,raw:unknown)=>{
  const args=raw && typeof raw==='object' && !Array.isArray(raw) ? raw as Record<string,unknown> : null;
  rawInputDiagnostics.push({toolName,parseable:args!==null,
   encodedTargets:args?['ref','target'].filter(key=>typeof args[key]==='string' && /^\s*\{/.test(args[key] as string)):[],
   literalNullFields:args?['moneySaved','recommendedNextStep'].filter(key=>args[key]==='null'):[],
   missingFactSourceUrls:args && Array.isArray(args.facts)?args.facts.filter(f=>f&&typeof f==='object'&&!('sourceUrl' in f)).length:0,
  });
 };
 const timeoutSignal=AbortSignal.timeout(8*60_000);
 const trialSignal=AbortSignal.any([evaluationAbort.signal,timeoutSignal]);
 const retryWaits:number[]=[];
 const timer=setInterval(async()=>{const s=await store.getSnapshot(run.id);if(s){writeFileSync(`${folder}/progress.json`,JSON.stringify({runId:run.id,userId:run.userId,elapsedMs:performance.now()-started,status:s.status,response:s.response,actions:s.actions},null,2));console.log('PROGRESS',label,Math.round((performance.now()-started)/1000),s.status,s.actions.length,s.actions.at(-1)?.toolName)}},15000);
 try {
  while(!trialSignal.aborted) {
   const outcome=await runAgent({store,runId:run.id,model:createAgentModel(store,{useGlobalSettings:false,onRawToolInput}),signal:trialSignal});
   if(!outcome?.retryAfterMs) break;
   retryWaits.push(outcome.retryAfterMs);console.log('RETRY_WAIT',label,outcome.retryAfterMs);
   let remaining=outcome.retryAfterMs;
   while(remaining>0){const wait=Math.min(60_000,remaining);await delay(wait,undefined,{signal:trialSignal});remaining-=wait;}
  }
 }catch(error){thrown=String(error);}finally{clearInterval(timer);} 
 const elapsedMs=performance.now()-started;
 const s=(await store.getSnapshot(run.id))!;
 for(const a of s.artifacts){const stored=await store.getArtifact(a.id,s.id);if(stored)writeFileSync(`${folder}/${a.name.replaceAll('/','_')}`,Buffer.from(stored.bytesBase64,'base64'));}
 const requests=(s.metadata[config.provider==='meta'?'metaRequests':'openaiRequests']??[]) as Array<Record<string,number>>;
 const estimatedModelCostUSD=requests.length?requests.reduce((total,r)=>{const i=r.inputTokens??0,o=r.outputTokens??0,c=r.cacheReadTokens??0,w=r.cacheWriteTokens??0;return total+(config.provider==='meta'?(i-c)*1.25+c*.15+o*4.25:(i-c-w)*2+c*.2+w*2.5+o*12)/1e6},0):null;
 const row={runId:run.id,userId:run.userId,interrupted:evaluationAbort.signal.aborted,timedOut:timeoutSignal.aborted,retryWaits,costCoverage:retryWaits.length?'partial: failed-turn usage is not recorded':'completed-turn usage',task:task.id,repetition,...config,elapsedMs,estimatedModelCostUSD,status:s.status,error:s.error,thrown,response:s.response,result:s.result,requests,rawInputDiagnostics,actions:s.actions,artifacts:s.artifacts};
 writeFileSync(`${folder}/result.json`,JSON.stringify(row,null,2));
 writeFileSync(`${folder}/messages.json`,JSON.stringify(await store.listMessages(run.id),null,2));
 console.log('RESULT',JSON.stringify({label,elapsedMs,status:s.status,error:s.error,thrown,estimatedModelCostUSD,actions:s.actions.length,verified:s.result?.verified}));
 try {await closeCloudBrowser(run.userId);}catch(error){console.log('CLEANUP_ERROR',label,String(error));}
 if(/Cannot connect to API|ENOTFOUND|EADDRNOTAVAIL|ECONNRESET|EAI_AGAIN/.test(String(s.error??thrown??''))){console.log('BATCH_STOP_NETWORK_FAILURE',label);break evaluation;}
}
process.exit(0);
