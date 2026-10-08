/** Record an existing evaluation browser's view-only stream; never take control. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
process.env.DATABASE_URL='postgresql://postgres:local-test-only@127.0.0.1:55441/postgres';
const root='artifacts/luna-sol-hard-2026-09-23/corrected';
const p=JSON.parse(readFileSync(`${root}/progress.json`,'utf8'));
const {getCloudBrowser}=await import('../lib/harness/browser/registry');
const provider=getCloudBrowser(p.userId,p.runId);
const live=await provider.watchUrl(p.userId);
mkdirSync(`${root}/video`,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:`${root}/video`,size:{width:1440,height:900}}});
const page=await context.newPage();const video=page.video()!;
try{
 await page.goto(live,{waitUntil:'domcontentloaded'});
 writeFileSync(`${root}/${p.modelId}-recording.json`,JSON.stringify({model:p.modelId,startedAt:new Date().toISOString(),runElapsedAtAttachSeconds:p.seconds,viewOnly:true}));
 console.log('RECORDING',p.modelId,'attached after',p.seconds,'seconds');
 await page.waitForTimeout(3000);await page.screenshot({path:`${root}/${p.modelId}-recording-start.png`});
 const deadline=Date.now()+15*60_000;
 while(Date.now()<deadline){
  await new Promise(r=>setTimeout(r,3000));
  const latest=JSON.parse(readFileSync(`${root}/progress.json`,'utf8'));
  const rows=JSON.parse(readFileSync(`${root}/results.json`,'utf8'));
  if(latest.runId!==p.runId||rows.some((r:any)=>r.task==='natura-checkout'&&r.modelId===p.modelId))break;
 }
}finally{await context.close();await video.saveAs(`${root}/${p.modelId}-checkout.webm`);await browser.close();console.log('SAVED',`${root}/${p.modelId}-checkout.webm`);process.exit(0)}
