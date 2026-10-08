/** Disposable Browserless/E2B timing probe. No user profile or submissions. */
import { BrowserlessCloudBrowserProvider, createCloudBrowserAccountState } from '../lib/harness/browser/cloud';
const account=createCloudBrowserAccountState();
const key='latency-probe-'+crypto.randomUUID();
const browser=new BrowserlessCloudBrowserProvider(key,account,key);
try {
 const start=performance.now();await browser.open(key,'https://example.com');
 console.log(JSON.stringify({phase:'startup',elapsedMs:performance.now()-start}));
 const sandbox=account.sandbox!;
 let spans:Array<{name:string;ms:number}>=[];
 function track(target:object,name:string) {
  const owner=target as Record<string,(...args:unknown[])=>Promise<unknown>>;
  const original=owner[name].bind(target);
  owner[name]=async(...args)=>{const at=performance.now();try{return await original(...args);}finally{spans.push({name,ms:performance.now()-at});}};
 }
 track(sandbox,'setTimeout');track(sandbox.files,'write');track(sandbox.files,'remove');track(sandbox.commands,'run');
 for(let i=0;i<3;i++){
  spans=[];const start=performance.now();const page=await browser.snapshot();
  if(!page.title.includes('Example'))throw Error('Unexpected probe page');
  console.log(JSON.stringify({phase:'snapshot',iteration:i,elapsedMs:performance.now()-start,spans}));
 }
}finally{await browser.destroy();}
