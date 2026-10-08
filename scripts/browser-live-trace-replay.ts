/** Diagnostic-only replay of recorded browser scripts through unchanged guarded tools. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createToolRegistry} from '../lib/harness/tools';
import {E2BSandboxProvider} from '../lib/harness/sandbox/e2b';
import {getCloudBrowser} from '../lib/harness/browser/registry';
import type {AgentModel,RunStore} from '../lib/harness/types';
export function browserTraceReplay(store:RunStore,path:string,output:string):AgentModel{
 const messages=JSON.parse(readFileSync(path,'utf8'));
 const calls=messages.flatMap((m:any)=>m.message.role==='assistant'&&Array.isArray(m.message.content)?m.message.content.filter((c:any)=>c.type==='tool-call'&&c.toolName==='browser_run'):[]);
 if(!calls.length)throw new Error('No recorded browser scripts');
 const sandbox=new E2BSandboxProvider();
 return{
  async turn({run,turnId,signal,onNarration}){
   const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:turnId,store,sandbox,sandboxState:{created:false},cloudBrowser:getCloudBrowser(run.userId,run.id),signal});
   const results=[];
   try{
    for(const [index,call] of calls.entries()){
     const started=performance.now();
     const value=await (registry.tools.browser_run.execute as any)(call.input,{toolCallId:`replay-${index}`,messages:[],abortSignal:signal});
     results.push({index,input:call.input,elapsedMs:performance.now()-started,value});
     writeFileSync(`${output}/replay.json`,JSON.stringify(results,null,2));
     console.log('REPLAY',index+1,calls.length,Math.round(performance.now()-started));
     if(process.env.BROWSER_REPLAY_REQUIRE_SUCCESS==='1' && value?.$toolError)throw new Error('Required replay step failed; inspect saved receipt before retrying');
    }
    await onNarration('Completed recorded browser-script sequence; inspect receipts for parity. No model call made.');
   }finally{await registry.close()}
  },
  async dispose(){await sandbox.destroy()},
 };
}
