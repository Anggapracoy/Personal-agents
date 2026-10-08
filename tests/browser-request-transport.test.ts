import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserlessCloudBrowserProvider } from '../lib/harness/browser/cloud';

test('small ordinary requests avoid remote files; secure and oversized requests retain them',async()=>{
 const browser=new BrowserlessCloudBrowserProvider();
 const writes:Array<{path:string;body:string}>=[];const removes:string[]=[];
 let command='';let env:Record<string,string>={};
 const sandbox={files:{write:async(path:string,body:string)=>{writes.push({path,body});},remove:async(path:string)=>{removes.push(path);}},commands:{run:async(cmd:string,options:{envs:Record<string,string>})=>{command=cmd;env=options.envs;return {stdout:'{"ok":true,"value":{"checked":true}}'};}}};
 const internal=browser as unknown as {runControllerCommand:(sandbox:unknown,operation:string,payload:unknown)=>Promise<unknown>};
 await internal.runControllerCommand(sandbox,'type',{ref:'e1',text:'hello "world"; $(do-not-execute)'});
 assert.equal(writes.length,0);assert.equal(removes.length,0);
 assert.deepEqual(JSON.parse(env.DASH_BROWSER_REQUEST).payload,{ref:'e1',text:'hello "world"; $(do-not-execute)'});
 assert.ok(!command.includes('hello')&&!command.includes('do-not-execute'));
 for(const [operation,payload] of [['secure_type',{text:'fixture-only'}],['extended',{data:'x'.repeat(33000)}]] as const){
  await internal.runControllerCommand(sandbox,operation,payload);
  assert.equal(env.DASH_BROWSER_REQUEST,undefined);
 }
 assert.equal(writes.length,2);assert.equal(removes.length,2);
 assert.deepEqual(writes.map(w=>w.path),removes);
});
