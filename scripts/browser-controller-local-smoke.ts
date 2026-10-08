import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { browserApprovalEvidence } from '../lib/harness/browser/approval';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
// Isolated local Chrome and local HTTPS fixtures only. No cloud credits, real
// vault data, user profile, or merchant requests.
const dir=mkdtempSync('/tmp/dash-browser-local-');
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'--no-first-run','--no-default-browser-check','--site-per-process','--ignore-certificate-errors','about:blank'],{stdio:'ignore',detached:true});
try {
 let controller=CLOUD_BROWSER_CONTROLLER;
 const baseline=process.argv.includes('--baseline');
 if(baseline){
  const source=spawnSync('git',['show','HEAD:lib/harness/browser/cloud-controller.ts'],{encoding:'utf8'});
  if(source.status!==0)throw new Error(source.stderr);
  const file=dir+'/baseline-controller.mts';
  writeFileSync(file,source.stdout.replace(/from \"\.\/([^\"]+)\"/g,(_match,name)=>`from ${JSON.stringify(resolve('lib/harness/browser',name+'.ts'))}`));
  controller=(await import(pathToFileURL(file).href)).CLOUD_BROWSER_CONTROLLER;
 }
 let port='';for(let i=0;i<100;i++){try{port=readFileSync(dir+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{}await new Promise(r=>setTimeout(r,100));}
 const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as any;
 const program=`approval_layout=${process.argv.includes('--approval-layout')?'True':'False'}\napproval_output=${JSON.stringify(dir+'/approval-layout.json')}\ncontroller=${JSON.stringify(controller)}\nendpoint=${JSON.stringify(version.webSocketDebuggerUrl)}\nbaseline=${baseline?'True':'False'}\ntyping=${process.argv.includes('--typing')?'True':'False'}\ncomparison=${process.argv.includes('--comparison')?'True':'False'}\nobservation=${process.argv.includes('--observation')?'True':'False'}\ncontrols=${process.argv.includes('--controls')?'True':'False'}\ncheckout=${process.argv.includes('--checkout')?'True':'False'}\n`+readFileSync(new URL('./fixtures/browser-controller-local.py', import.meta.url),'utf8');
 process.exitCode=await new Promise<number>((done,reject)=>{
  const child=spawn('python3',['-u','-c',program],{stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  child.once('error',error=>{clearTimeout(timer);reject(error)});
  child.once('exit',code=>{clearTimeout(timer);done(code??1)});
 });
 if (process.argv.includes('--approval-layout') && process.exitCode === 0) {
  const snapshots=JSON.parse(readFileSync(dir+'/approval-layout.json','utf8'));
  const evidence=browserApprovalEvidence(snapshots[0].page, snapshots[0].page.elements.find((e:any)=>e.name==='Place order').ref);
  for(const entry of snapshots.slice(1)) {
   if(entry.changed) assert.notEqual(browserApprovalEvidence(entry.page, snapshots[0].page.elements.find((e:any)=>e.name==='Place order').ref),evidence,entry.label);
   else assert.equal(browserApprovalEvidence(entry.page, snapshots[0].page.elements.find((e:any)=>e.name==='Place order').ref),evidence,entry.label);
   console.log('PASS approval:',entry.label);
  }
 }
} finally {if(chrome.pid){try{process.kill(-chrome.pid,'SIGKILL')}catch{}}await new Promise(r=>setTimeout(r,500));rmSync(dir,{recursive:true,force:true});}
