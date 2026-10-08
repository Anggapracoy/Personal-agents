import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {localBrowser} from './local-browser';
const root=process.env.LOCATOR_BENCHMARK_OUTPUT??'/tmp/dash-multiframe-locator-speed';mkdirSync(root,{recursive:true});const rows:any[]=[];
const html=(url:string)=>url.startsWith('https://locator-benchmark.example')?`<title>Main interface</title><button id="continue">Continue</button><button id="same">Duplicate</button>${Array.from({length:14},(_,i)=>`<iframe src="https://frames-benchmark.example/${i}" title="Embedded panel ${i}"></iframe>`).join('')}`:`<title>Embedded panel</title><p>Frame content</p>${url.endsWith('/0')?'<button id="child">Inside frame</button><button>Duplicate</button>':''}`;
for(let trial=0;trial<Number(process.env.BROWSER_LOCATOR_TRIALS??5);trial++)for(const arm of trial%2?['new','old']:['old','new']){
 process.env.BROWSER_LOCATOR_BASELINE=arm==='old'?'1':'0';const browser=await localBrowser('locator@example.invalid',crypto.randomUUID(),{url:'https://locator-benchmark.example/',html});
 try{
  await browser.provider.navigate('https://locator-benchmark.example/');await browser.page.waitForFunction(()=>document.querySelectorAll('iframe').length===14);
  await Promise.all(browser.page.frames().map(f=>f.waitForLoadState('domcontentloaded')));await browser.provider.snapshot();
  let observedRef="";const times=[];for(let i=0;i<5;i++){const start=performance.now();const result=await browser.provider.preflightLocator({role:'button',name:'Continue',exact:true},false);times.push(performance.now()-start);assert.equal(result.matches.length,1);assert.equal(result.element?.name,'Continue');observedRef=result.ref!;}
  const child=await browser.provider.preflightLocator({role:'button',name:'Inside frame',exact:true},false);assert.equal(child.matches.length,1);assert.equal((child.element as any)?.mainFrame,false);
  assert.equal((await browser.provider.preflightLocator({role:'button',name:'Duplicate',exact:true},false)).matchCount,2);
  await browser.page.evaluate(()=>document.querySelector('#continue')!.remove());const absent=await browser.provider.preflightLocator({role:'button',name:'Continue',exact:true},false);assert.equal(absent.matches.length,0);await assert.rejects(browser.provider.describeRef(observedRef),/stale/);
  await browser.page.evaluate(()=>document.body.insertAdjacentHTML('afterbegin','<button>New control</button>'));const fresh=await browser.provider.preflightLocator({role:'button',name:'New control',exact:true},false);assert.equal(fresh.matches.length,1);
  // A newly inserted duplicate must invalidate the fast path and preserve ambiguity.
  await browser.page.evaluate(()=>document.body.insertAdjacentHTML('afterbegin','<button>New control</button>'));assert.equal((await browser.provider.preflightLocator({role:'button',name:'New control',exact:true},false)).matchCount,2);
  rows.push({trial,arm,times});writeFileSync(root+'/results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify({trial,arm,times}));
 }finally{await browser.close()}
}
const median=(xs:number[])=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];const old=median(rows.filter(x=>x.arm==='old').flatMap(x=>x.times)),next=median(rows.filter(x=>x.arm==='new').flatMap(x=>x.times));console.log(JSON.stringify({oldMs:old,newMs:next,fasterPercent:(1-next/old)*100}));delete process.env.BROWSER_LOCATOR_BASELINE;
