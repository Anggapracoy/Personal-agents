/** Same-page alternating transport probe; no model, user account, or submissions. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
import {getCloudBrowser,closeCloudBrowser} from '../lib/harness/browser/registry';
if(!process.env.COMPARISON_DATABASE_URL||new URL(process.env.COMPARISON_DATABASE_URL).hostname!=='127.0.0.1')throw new Error('Local diagnostic storage required');
process.env.DATABASE_URL=process.env.COMPARISON_DATABASE_URL;
const owner=`observation-speed-${crypto.randomUUID()}@example.invalid`;
const browser=getCloudBrowser(owner,crypto.randomUUID());
const internal=browser as unknown as {controllerPath:string;account:{sandbox:{files:{write:(path:string,contents:string)=>Promise<unknown>}}}};
const root=process.env.COMPARISON_OUTPUT_DIR!;assert.ok(root);mkdirSync(root,{recursive:true});
const rows:Array<{arm:string;elapsedMs:number;controls:Array<{ref:string;role:string;name:string}>;elements:number}>=[];
try{
 await browser.open(owner,'https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-s29416758/');
 await browser.wait(1500);
 for(const arm of ['baseline','parallel','parallel','baseline','baseline','parallel']){
  const controller=arm==='baseline'?CLOUD_BROWSER_CONTROLLER.replace('if hasattr(cdp, "read_commands"):\n        try:\n            cdp.snapshot_native_reads', 'if False:\n        try:\n            cdp.snapshot_native_reads'):CLOUD_BROWSER_CONTROLLER;
  await internal.account.sandbox.files.write(internal.controllerPath,controller);
  const start=performance.now();const page=await browser.snapshot();const elapsedMs=performance.now()-start;
  assert.match(page.text,/LAGKAPTEN/);assert.match(page.text,/59\.99/);
  const controls=page.elements.filter(e=>e.name==='Measurements'||e.name==='Add to bag').map(e=>({ref:e.ref,role:e.role,name:e.name}));
  assert.ok(controls.length>=2);if(rows.length)assert.deepEqual(controls,rows[0].controls);
  rows.push({arm,elapsedMs,controls,elements:page.elements.length});
  writeFileSync(`${root}/snapshot-${rows.length}-${arm}.json`,JSON.stringify(page,null,2));
  writeFileSync(`${root}/results.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.at(-1)));
 }
}finally{await closeCloudBrowser(owner);writeFileSync(`${root}/cleanup.json`,JSON.stringify({closed:true}))}
process.exit(0);
