/** Alternating real-page ref reads; no model, login, or page mutation. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
import {getCloudBrowser,closeCloudBrowser} from '../lib/harness/browser/registry';
const database=process.env.COMPARISON_DATABASE_URL;
if(!database||new URL(database).hostname!=='127.0.0.1')throw new Error('Isolated local database required');
process.env.DATABASE_URL=database;
const root=process.env.COMPARISON_OUTPUT_DIR!;assert.ok(root);mkdirSync(root,{recursive:true});
const owner=`ref-speed-${crypto.randomUUID()}@example.invalid`;
const browser=getCloudBrowser(owner,crypto.randomUUID());
const internal=browser as unknown as {controllerPath:string;account:{sandbox:{files:{write:(path:string,contents:string)=>Promise<unknown>}}}};
const baseline=CLOUD_BROWSER_CONTROLLER
 .replace("existing_ref=bool(locator.get('ref'))",'existing_ref=False')
 .replace(" : q.ref ? deepQueryAll('[data-decision-feed-ref=\"'+CSS.escape(q.ref)+'\"]',root)",'');
assert.notEqual(baseline,CLOUD_BROWSER_CONTROLLER);
const rows:Array<{arm:string;elapsedMs:number;queries:number}>=[];
const observations=new Map<string,unknown>();
try{
 await browser.open(owner,'https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-s29416758/');
 const links=await browser.extended({action:'query',locator:{role:'link'}}) as {matches:Array<{ref:string}>};
 const refs=links.matches.slice(0,12).map(row=>row.ref);assert.ok(refs.length>=8);
 for(const arm of ['baseline','batched','batched','baseline']){
  await internal.account.sandbox.files.write(internal.controllerPath,arm==='baseline'?baseline:CLOUD_BROWSER_CONTROLLER);
  const start=performance.now();
  for(const ref of refs){
   const value=await browser.extended({action:'query',locator:{ref}}) as {matches:Array<{ref:string;text:string;attributes:unknown;enabled:boolean}>};
   const content=value.matches.map(({ref,text,attributes,enabled})=>({ref,text,attributes,enabled}));
   assert.equal(content.length,1);
   if(observations.has(ref))assert.deepEqual(content,observations.get(ref));else observations.set(ref,content);
  }
  rows.push({arm,elapsedMs:performance.now()-start,queries:refs.length});
  writeFileSync(`${root}/results.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.at(-1)));
 }
}finally{
 await closeCloudBrowser(owner);writeFileSync(`${root}/cleanup.json`,JSON.stringify({browserClosed:true}));
}
process.exit(0);
