/** Local-only before/after keyboard measurement. No model or paid browser calls.
 * Uses the real script facade, controller preflight, key dispatch and snapshots.
 * Local JSON transport replaces E2B/Browserless; database/receipt work is excluded.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
import { runBrowserScript } from '../lib/harness/browser/script';

const mode = process.argv[2];
assert.ok(mode === 'before' || mode === 'after');
const dir = mkdtempSync('/tmp/dash-keyboard-speed-');
const chrome = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], {stdio:'ignore',detached:true});
let child: ReturnType<typeof spawn> | undefined;
try {
 let port='';
 for(let i=0;i<100;i++){try{port=readFileSync(dir+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{await new Promise(r=>setTimeout(r,100))}}
 assert.ok(port);
 const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as {webSocketDebuggerUrl:string};
 const transport=readFileSync(new URL('./fixtures/browser-controller-local.py',import.meta.url),'utf8').split('with tempfile.TemporaryDirectory() as d:')[0];
 const body=readFileSync(new URL('./fixtures/browser-keyboard-speed.py',import.meta.url),'utf8');
 child=spawn('python3',['-u','-c',`controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\nendpoint=${JSON.stringify(version.webSocketDebuggerUrl)}\nd=${JSON.stringify(dir)}\n`+transport+body],{stdio:['pipe','pipe','inherit']});
 const lines=createInterface({input:child.stdout!})[Symbol.asyncIterator]();
 const ready=await lines.next();assert.equal(JSON.parse(ready.value!).ready,true);
 async function rpc(operation:string,payload:unknown={}){
  child!.stdin!.write(JSON.stringify({operation,payload})+'\n');
  const line=await lines.next();assert.ok(!line.done,'Controller exited');
  const reply=JSON.parse(line.value);if(reply.error)throw new Error(reply.error);return reply.value;
 }
 const measurements=[];
 for(let trial=0;trial<6;trial++){
  await rpc('reset');
  let actions=0;
  const start=performance.now();
  const result=await runBrowserScript(`await browser.page().getByRole('button',{name:'Keyboard target',exact:true}).pressSequentially('slate',{purpose:'Enter text',requiresApproval:false});`,async(name,input:any)=>{
   assert.equal(name,'browser_press');actions++;
   const pre=await rpc('preflight_locator',{locator:input.ref.locator,fullPage:false});
   assert.equal(pre.matches.length,1);
   const page=await rpc('press',{ref:pre.matches[0].ref,key:input.key,observeOutcome:false});
   return {snapshot:JSON.stringify(page),url:page.url};
  });
  const elapsedMs=performance.now()-start;
  assert.equal(result.$toolError,undefined,JSON.stringify(result));
  const state=await rpc('state');
  assert.equal(state.text,'slate');assert.equal(state.events,10);
  assert.equal(state.trusted,true);
  measurements.push({trial,warmup:trial===0,elapsedMs,actions,...state});
 }
 const sorted=measurements.slice(1).map(x=>x.elapsedMs).sort((a,b)=>a-b);
 const report={mode,scope:'Local HTTP website in Chromium; actual script facade, controller preflight, keyboard events and final observations. Excludes model, database, E2B and Browserless network.',medianMs:sorted[2],measurements};
 writeFileSync(`/tmp/dash-keyboard-${mode}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 await rpc('stop');
} finally {
 child?.stdin?.end();child?.kill('SIGTERM');
 if(chrome.pid){try{process.kill(-chrome.pid,'SIGKILL')}catch{}}
 await new Promise(r=>setTimeout(r,200));rmSync(dir,{recursive:true,force:true});
}
