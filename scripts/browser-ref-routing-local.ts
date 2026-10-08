/** Exact-ref preflight measurement against real Chromium. Main/iframe controls,
 * 40 tracking frames, 50ms simulated CDP RTT; no paid cloud sessions.
 * Capture the controller string before a change; pass its path as argument 3
 * to `before`. With no path, both modes use the current controller.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { CLOUD_BROWSER_CONTROLLER as currentController } from '../lib/harness/browser/cloud-controller';

const mode = process.argv[2];
assert.ok(mode === 'before' || mode === 'after');
const dir = mkdtempSync('/tmp/dash-observation-budget-');
const chrome = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], {stdio:'ignore',detached:true});
let child: ReturnType<typeof spawn> | undefined;
try {
 let CLOUD_BROWSER_CONTROLLER=currentController;
 if(mode==='before' && process.argv[3])CLOUD_BROWSER_CONTROLLER=readFileSync(process.argv[3],'utf8');
 let port='';
 for(let i=0;i<100;i++){try{port=readFileSync(dir+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{await new Promise(r=>setTimeout(r,100))}}
 assert.ok(port);
 const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as {webSocketDebuggerUrl:string};
 const transport=readFileSync(new URL('./fixtures/browser-controller-local.py',import.meta.url),'utf8').split('with tempfile.TemporaryDirectory() as d:')[0];
 const body=readFileSync(new URL('./fixtures/browser-ref-routing.py',import.meta.url),'utf8');
 child=spawn('python3',['-u','-c',`test_mode=${JSON.stringify(mode)}\ncontroller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\nendpoint=${JSON.stringify(version.webSocketDebuggerUrl)}\nd=${JSON.stringify(dir)}\n`+transport+body],{stdio:['pipe','pipe','inherit']});
 const lines=createInterface({input:child.stdout!})[Symbol.asyncIterator]();
 const ready=await lines.next();assert.equal(JSON.parse(ready.value!).ready,true);
 async function rpc(operation:string,payload:unknown={}){
  child!.stdin!.write(JSON.stringify({operation,payload})+'\n');
  const line=await lines.next();assert.ok(!line.done,'Controller exited');
  const reply=JSON.parse(line.value);if(reply.error)throw new Error(reply.error);return reply.value;
 }
 const report=await rpc('measure');
 writeFileSync(`/tmp/dash-ref-routing-${mode}.json`,JSON.stringify({mode,...report},null,2));
 assert.equal(report.staleRejected,true);assert.equal(report.frameControlPreserved,true);
 assert.equal(report.mainClickedOnce,true);assert.equal(report.frameClickedOnce,true);
 writeFileSync(`/tmp/dash-ref-routing-${mode}.json`,JSON.stringify({mode,...report},null,2));
 console.log(JSON.stringify({mode,...report},null,2));
 await rpc('stop');
} finally {
 child?.stdin?.end();child?.kill('SIGTERM');
 if(chrome.pid){try{process.kill(-chrome.pid,'SIGKILL')}catch{}}
 await new Promise(r=>setTimeout(r,200));rmSync(dir,{recursive:true,force:true});
}
