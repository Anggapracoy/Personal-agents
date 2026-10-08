import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {localBrowser} from './local-browser';
import {MemoryRunStore} from '../../lib/harness/store';
import {createToolRegistry} from '../../lib/harness/tools';
import type {SandboxProvider} from '../../lib/harness/sandbox/types';
const root=process.env.KEYBOARD_BENCHMARK_OUTPUT??'/tmp/dash-page-keyboard-speed';mkdirSync(root,{recursive:true});
const rows:any[]=[];
const html=`<title>Keyboard puzzle</title><h1>Keyboard puzzle</h1><div id="board" aria-live="polite"></div><button aria-label="enter" onclick="submitGuess()">Enter</button>${Array.from({length:250},(_,i)=>`<p>Help ${i}: Each guess contains five letters. Feedback remains visible.</p>`).join('')}<script>window.guesses=[];window.word='';function submitGuess(){if(word.length!==5)return;guesses.push(word);word='';document.querySelector('#board').textContent='Accepted guesses: '+guesses.join(', ')}document.addEventListener('keydown',e=>{if(e.key==='Enter')submitGuess();else if(e.key==='Backspace')word=word.slice(0,-1)});document.addEventListener('keypress',e=>{if(/^[a-z]$/i.test(e.key))word+=e.key.toLowerCase()});</script>`;
for(let trial=0;trial<5;trial++)for(const arm of trial%2?['new','old']:['old','new']){
 const store=new MemoryRunStore();const run=await store.createRun({userId:`keyboard-${crypto.randomUUID()}@example.invalid`,decisionId:null,category:'evaluation',title:'Keyboard speed',request:'Prepare four guesses',metadata:{}});
 const browser=await localBrowser(run.userId,run.id,{url:'https://keyboard-benchmark.example/',html:()=>html});
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'benchmark',store,cloudBrowser:browser.provider,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 const exec=async(code:string)=>await registry.tools.browser_run.execute!({code,purpose:'Play known keyboard guesses'},{toolCallId:crypto.randomUUID(),messages:[],context:{}}) as any;
 try{
  await browser.provider.navigate('https://keyboard-benchmark.example/');const startIndex=browser.timings.length;const started=performance.now();
  for(const word of ['slate','crony','diver','river']){
   const code=arm==='old'?`const p=browser.page(); await p.keyboard.type('${word}',{purpose:'Enter known guess'}); const r=await p.getByRole('button',{name:'enter',exact:true}).click({purpose:'Submit game guess',requiresApproval:false}); print(r.snapshot);`:`const p=browser.page(); await p.keyboard.type('${word}',{purpose:'Enter known guess'}); const r=await p.keyboard.press('Enter',{purpose:'Submit game guess',requiresApproval:false}); print(r.snapshot);`;
   const result=await exec(code);
   assert.equal(result.$toolError,undefined,JSON.stringify(result));assert.match(result.snapshot??'',new RegExp(word));
  }
  const ms=performance.now()-started;assert.deepEqual(await browser.page.evaluate(()=> (window as any).guesses),['slate','crony','diver','river']);
  const timings=browser.timings.slice(startIndex);const actions=(await store.getSnapshot(run.id))!.actions; rows.push({trial,arm,ms,rpcs:timings.length,timings,actions:actions.length,observations:actions.filter(a=>typeof a.result?.snapshot === "string").length,deferred:actions.filter(a=>a.result?.observationDeferred===true).length});
  console.log(JSON.stringify({trial,arm,ms,rpcs:timings.length}));writeFileSync(root+'/results.json',JSON.stringify(rows,null,2));
  if(trial===0&&arm==='new'){
   // Real-controller negative tests: no dispatch into fields/forms or after
   // focus changes between a successful type and Enter.
   await browser.page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<form><input aria-label="Sensitive form"><button>Buy now</button></form>');});
   await assert.rejects(browser.provider.pressPageKey('Enter'),/neutral non-form/);
   await browser.page.evaluate(()=>{document.querySelector('form')!.remove();document.body.insertAdjacentHTML('beforeend','<button id="buy">Buy now</button>');});
   await assert.rejects(browser.provider.pressPageKey('Enter'),/neutral non-form/);
   await browser.page.evaluate(()=>{document.querySelector('#buy')!.remove();document.body.insertAdjacentHTML('beforeend','<input id="focused">');(document.querySelector('#focused') as HTMLInputElement).focus();});
   await assert.rejects(browser.provider.pressPageKey('Enter'),/neutral non-form/);
   await browser.page.evaluate(()=>{document.querySelector('#focused')!.remove();document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-modal="true">Notice</div>');});
   await assert.rejects(browser.provider.pressPageKey('Enter'),/neutral non-form/);
   await browser.page.evaluate(()=>document.querySelector('[role="dialog"]')!.remove());
   await assert.rejects(browser.provider.pressPageKey('Enter'),/recent page typing/);
   assert.deepEqual(await browser.page.evaluate(()=> (window as any).guesses),['slate','crony','diver','river']);
   await browser.page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<iframe id="ad" srcdoc="<p>Advert</p>"></iframe>'));
   await browser.provider.typePageTextWithoutObservation('slate');
   await browser.provider.pressPageKey('Enter');
   assert.equal(await browser.page.evaluate(()=> (window as any).guesses.length),5);
   await browser.page.evaluate(()=>document.querySelector('#ad')!.remove());
   await browser.provider.typePageTextWithoutObservation('slate');
   await browser.page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<input id="late-focus">');(document.querySelector('#late-focus') as HTMLInputElement).focus();});
   await assert.rejects(browser.provider.pressPageKey('Enter'),/neutral non-form/);
   await browser.page.evaluate(()=>document.querySelector('#late-focus')!.remove());
   await browser.provider.navigate('https://keyboard-benchmark.example/');
   await assert.rejects(browser.provider.pressPageKey('Enter'),/recent page typing/);
   await browser.page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<input type="password">'));
   await assert.rejects(browser.provider.pressPageKey('Enter'),/secure pages/);
   console.log('Form, consequential button, focused-input, late focus change, modal, navigation, secure-page and repeat-Enter guards passed');
  }
 }finally{await registry.close();await browser.close()}
}
const median=(xs:number[])=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const old=median(rows.filter(r=>r.arm==='old').map(r=>r.ms)),next=median(rows.filter(r=>r.arm==='new').map(r=>r.ms));console.log(JSON.stringify({oldMedianMs:old,newMedianMs:next,fasterPercent:(1-next/old)*100}));
