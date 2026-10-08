import assert from 'node:assert/strict';
import {localBrowser} from './local-browser';
import {MemoryRunStore} from '../../lib/harness/store';
import {createToolRegistry} from '../../lib/harness/tools';
import type {SandboxProvider} from '../../lib/harness/sandbox/types';
const store=new MemoryRunStore();const run=await store.createRun({userId:'ambiguity@example.invalid',decisionId:null,category:'evaluation',title:'Modal recovery',request:'Dismiss notice',metadata:{}});
const html=`<title>Modal recovery</title><div role="dialog" aria-label="Old notice" style="display:none"><button onclick="window.wrong=true">Close</button></div><div role="dialog" aria-modal="true" aria-label="Bonus notice" style="position:fixed;inset:20px;background:white;z-index:10"><button onclick="window.closedNotice=true;this.parentElement.remove()">Close</button><input type="password" value="secret-marker-must-not-leak"></div><script>window.wrong=false;window.closedNotice=false</script>`;
const browser=await localBrowser(run.userId,run.id,{url:'https://ambiguity-benchmark.example/',html:()=>html});const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'verify',store,cloudBrowser:browser.provider,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
try{
 await browser.provider.navigate('https://ambiguity-benchmark.example/');const start=browser.timings.length;
 const exec=async(code:string)=>await registry.tools.browser_run.execute!({code,purpose:'Dismiss notice'},{toolCallId:crypto.randomUUID(),messages:[],context:{}}) as any;
 const result=await exec(`await browser.page().getByRole('button',{name:'Close',exact:true}).click({purpose:'Dismiss notice',requiresApproval:false});`);
 assert.equal(result.$toolError,true);assert.equal(result.ambiguity.inputDispatched,false);assert.equal(result.ambiguity.matchCount,2);assert.equal(await browser.page.evaluate(()=>(window as any).closedNotice),false);
 assert.ok(!JSON.stringify(result).includes('secret-marker-must-not-leak'));
 const chosen=result.ambiguity.candidates.find((c:any)=>c.visible&&c.containers.some((x:any)=>x.role==='dialog'&&x.name==='Bonus notice'));assert.ok(chosen);
 const old=result.ambiguity.candidates.find((c:any)=>!c.visible);assert.equal(old.containers[0].name,'Old notice');
 const recovered=await exec(`await browser.page().ref('${chosen.ref}').click({purpose:'Dismiss the bonus notice',requiresApproval:false});`);assert.equal(recovered.$toolError,undefined,JSON.stringify(recovered));assert.equal(await browser.page.evaluate(()=>(window as any).closedNotice),true);assert.equal(await browser.page.evaluate(()=>(window as any).wrong),false);
 assert.equal(browser.timings.slice(start).filter(x=>x.operation==='snapshot').length,0);console.log('Two Close buttons correctly identified with dialog/visibility context; no input on ambiguity, no secret values, correct recovery without extra inspect.');
}finally{await registry.close();await browser.close()}
