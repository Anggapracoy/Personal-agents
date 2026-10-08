import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {CLOUD_BROWSER_CONTROLLER} from '../../lib/harness/browser/cloud-controller';
import {localBrowser} from './local-browser';
const extract=spawnSync('python3',['-c',`import sys,json
ns={'__name__':'local_test'}
exec(sys.stdin.read(),ns)
print(json.dumps(ns['SNAPSHOT_EXPRESSION'].replace('__REF_START__','0')))`],{input:CLOUD_BROWSER_CONTROLLER,encoding:'utf8'});
if(extract.status!==0)throw Error(extract.stderr);const optimized=JSON.parse(extract.stdout.trim());
const root='/tmp/dash-snapshot-speed';mkdirSync(root,{recursive:true});const browser=await chromium.launch();const rows:any[]=[];
try{
 for(const count of [50,250,750]){
  const context=await browser.newContext();const page=await context.newPage();
  await page.setContent(`<title>Busy keyboard app</title><main><h1>Keyboard game</h1><button>Enter</button><div id="mount"></div><input type="password" aria-label="Password" value="must-not-leak"></main>`);
  await page.evaluate(n=>{const mount=document.querySelector('#mount')!;for(let i=0;i<n;i++){const host=document.createElement('div');mount.append(host);const shadow=host.attachShadow({mode:'open'});shadow.innerHTML=`<section role="region" aria-label="Panel ${i}"><button aria-label="Control ${i}">Control</button><input aria-label="Search ${i}"></section>`;}},count);
  await page.evaluate(optimized); // identical ref warmup, excluded
  for(let trial=0;trial<5;trial++){
   const start=performance.now();const value:any=await page.evaluate(optimized);const ms=performance.now()-start;
   assert.ok(value.elements.length>count);const password=value.elements.find((x:any)=>x.name==='Password');assert.equal(password.value,undefined);assert.equal(password.valueRedacted,true);
   rows.push({count,trial,ms,elements:value.elements.length});
  }
  await context.close();
 }
}finally{await browser.close()}
writeFileSync(root+'/renderer-results.json',JSON.stringify(rows,null,2));const median=(xs:number[])=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];for(const count of [50,250,750])console.log(JSON.stringify({shadowRoots:count,medianMs:median(rows.filter(r=>r.count===count).map(r=>r.ms)),maxMs:Math.max(...rows.filter(r=>r.count===count).map(r=>r.ms))}));
// End-to-end observation through real CDP, including AX and secret redaction.
const runId=crypto.randomUUID();const fixture=await localBrowser('snapshot@example.invalid',runId,{url:'https://snapshot-benchmark.example/',html:()=>`<title>Keyboard app</title><h1>Game</h1>${Array.from({length:300},(_,i)=>`<button>Control ${i}</button>`).join('')}<input aria-label="Password" type="password" value="must-not-leak">`});
try{await fixture.provider.navigate('https://snapshot-benchmark.example/');const samples=[];for(let i=0;i<5;i++){const start=performance.now();const value=await fixture.provider.snapshot();samples.push(performance.now()-start);assert.ok(!JSON.stringify(value).includes('must-not-leak'));}writeFileSync(root+'/full-results.json',JSON.stringify(samples));console.log(JSON.stringify({fullSnapshotMedianMs:median(samples),fullSnapshotMaxMs:Math.max(...samples)}));}finally{await fixture.close()}
