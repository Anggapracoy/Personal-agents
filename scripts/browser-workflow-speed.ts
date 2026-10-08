/** Local-only before/after workflow measurement. No model or paid browser calls.
 * Uses the real script facade, controller preflight, key dispatch and snapshots.
 * Local JSON transport replaces E2B/Browserless; database/receipt work is excluded.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
import { runBrowserScript as currentRunBrowserScript } from '../lib/harness/browser/script';
import { isBrowserObservationDiscarded } from '../lib/harness/browser/discarded-observation';

const mode = process.argv[2];
assert.ok(mode === 'before' || mode === 'after');
// Compare the deployed baseline, independent of the working-tree implementation.
let runBrowserScript=currentRunBrowserScript;
if(mode==='before'){
 const baseline=new URL('../lib/harness/browser/.workflow-baseline-'+randomUUID()+'.ts',import.meta.url);
 try{
  writeFileSync(baseline,execFileSync('git',['show','8531904:lib/harness/browser/script.ts']));
  runBrowserScript=(await import(baseline.href)).runBrowserScript;
 }finally{rmSync(fileURLToPath(baseline),{force:true})}
}
const dir = mkdtempSync('/tmp/dash-workflow-speed-');
const chrome = spawn(chromium.executablePath(), ['--headless=new', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], {stdio:'ignore',detached:true});
let child: ReturnType<typeof spawn> | undefined;
try {
 let port='';
 for(let i=0;i<100;i++){try{port=readFileSync(dir+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{await new Promise(r=>setTimeout(r,100))}}
 assert.ok(port);
 const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as {webSocketDebuggerUrl:string};
 const transport=readFileSync(new URL('./fixtures/browser-controller-local.py',import.meta.url),'utf8').split('with tempfile.TemporaryDirectory() as d:')[0];
 const body=readFileSync(new URL('./fixtures/browser-workflow-speed.py',import.meta.url),'utf8');
 child=spawn('python3',['-u','-c',`controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\nendpoint=${JSON.stringify(version.webSocketDebuggerUrl)}\nd=${JSON.stringify(dir)}\n`+transport+body],{stdio:['pipe','pipe','inherit']});
 const lines=createInterface({input:child.stdout!})[Symbol.asyncIterator]();
 const ready=await lines.next();assert.equal(JSON.parse(ready.value!).ready,true);
 async function rpc(operation:string,payload:unknown={}){
  child!.stdin!.write(JSON.stringify({operation,payload})+'\n');
  const line=await lines.next();assert.ok(!line.done,'Controller exited');
  const reply=JSON.parse(line.value);if(reply.error)throw new Error(reply.error);return reply.value;
 }
 const reports=[];
 const fill=(i:number,defer=false)=>`await p.getByRole('textbox',{name:'Field ${i}',exact:true}).fill('value${i}',{purpose:'Fill field'${defer?',observe:false':''}});`;
 const scenarios = {
  fields: `const p=browser.page();${Array.from({length:5},(_,i)=>fill(i)).join('')}`,
  repeated_inspection: mode==='before' ? `const p=browser.page();${fill(0)}print((await p.inspect()).snapshot);` : `const p=browser.page();const result=await p.getByRole('textbox',{name:'Field 0',exact:true}).fill('value0',{purpose:'Fill field'});print(result.snapshot);`,
  fixed_wait: mode==='before' ? `const p=browser.page();await p.wait(5000);print(await p.getByRole('button',{name:'Ready',exact:true}).isEnabled());` : `const p=browser.page();await p.getByRole('button',{name:'Ready',exact:true}).waitFor({state:'enabled',timeoutMs:5000});print(await p.getByRole('button',{name:'Ready',exact:true}).isEnabled());`,
  missing_target: `await browser.page().getByRole('button',{name:'Ready',exact:true}).click({purpose:'Activate ready control',requiresApproval:false});`,
 };
 for(const [scenario,code] of Object.entries(scenarios)){
  const measurements=[];
  for(let trial=0;trial<4;trial++){
   console.log('START',mode,scenario,trial);
   await rpc('reset',{scenario});
   let actions=0;
   const start=performance.now();
   const result=await runBrowserScript(code,async(name,input:any)=>{
    actions++;
    if(name==='browser_extended')return rpc('extended',input);
    if(name==='browser_type'){
     const page=await rpc('type',{ref:input.ref,text:input.text,deferObservation:input.deferObservation===true || isBrowserObservationDiscarded()});
     return page.observationDeferred ? page : {snapshot:JSON.stringify(page),url:page.url};
    }
    if(name==='browser_inspect'){
     const page=await rpc('snapshot');return {snapshot:JSON.stringify(page),url:page.url};
    }
    if(name==='browser_wait'){
     const page=await rpc('wait',{milliseconds:input.milliseconds,deferObservation:isBrowserObservationDiscarded()});return page.observationDeferred ? page : {snapshot:JSON.stringify(page),url:page.url};
    }
    assert.equal(name,'browser_click');
    const pre=await rpc('preflight_locator',{locator:input.ref.locator,fullPage:false});
    if(!pre.matches.length)return {locatorMissing:true};
    assert.equal(pre.matches.length,1);
    const page=await rpc('click',{ref:pre.matches[0].ref,observeOutcome:false});
    return {snapshot:JSON.stringify(page),url:page.url};
   });
   const elapsedMs=performance.now()-start;
   assert.equal(result.$toolError,undefined,JSON.stringify(result));
   const state=await rpc('state');
   if(scenario==='fields')assert.deepEqual(state.values,['value0','value1','value2','value3','value4']);
   if(scenario==='repeated_inspection')assert.equal(state.values[0],'value0');
   if(scenario==='fixed_wait'){assert.equal(state.ready,true);assert.deepEqual(result.printed,[true])}
   if(scenario==='missing_target')assert.equal(state.clicks,1);
   measurements.push({trial,warmup:trial===0,elapsedMs,actions,...state});
  }
  const sorted=measurements.slice(1).map(x=>x.elapsedMs).sort((a,b)=>a-b);
  const report={scenario,medianMs:sorted[1],measurements};reports.push(report);
  console.log(JSON.stringify({mode,scenario,medianMs:report.medianMs}));
 }
 const report={mode,scope:'Local HTTP website in Chromium; actual script facade and controller. Fields and missing-target scenarios use identical code before/after runtime changes. Inspection reuse and fixed wait compare existing API strategies. No model, database, E2B or Browserless network.',reports};
 writeFileSync(`/tmp/dash-workflow-${mode}.json`,JSON.stringify(report,null,2));
 await rpc('stop');
} finally {
 child?.stdin?.end();child?.kill('SIGTERM');
 if(chrome.pid){try{process.kill(-chrome.pid,'SIGKILL')}catch{}}
 await new Promise(r=>setTimeout(r,200));rmSync(dir,{recursive:true,force:true});
}
