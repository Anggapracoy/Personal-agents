import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';

for (const batching of [false, true]) test(`native chrome avoids idle polling and tracks motion (${batching ? 'batched' : 'legacy'} bridge)`,async({page})=>{
 await page.addInitScript((batching)=>{
  const w=window as any;
  w.chromeReads={style:0,rect:0,raf:0};w.chromePackets=[];
  const style=window.getComputedStyle.bind(window);window.getComputedStyle=(...args:any[])=>{w.chromeReads.style++;return style(args[0],args[1]);};
  const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){w.chromeReads.rect++;return rect.call(this);};
  const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=(callback)=>{w.chromeReads.raf++;return raf(callback);};
  w.__decisionFeedNativeGlassButtons=true;w.__decisionFeedNativeBrowserClose=true;w.__decisionFeedNativeChromeBatch=batching;
  w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>{
   const packets=message.action==='chromeBatch'?message.payload.messages:[message];
   for(const packet of packets){
    w.chromePackets.push({action:packet.action,payload:packet.payload});
    if(['glassButtonState','browserCloseState'].includes(packet.action)&&!packet.payload.hidden){
     const name=packet.action==='glassButtonState'?'decisionFeed:glassButtonAction':'decisionFeed:browserCloseAction';
     queueMicrotask(()=>window.dispatchEvent(new CustomEvent(name,{detail:{id:packet.payload.id,action:'ready'}})));
    }
   }
  }}}};
 },batching);
 await page.clock.install();
 await page.goto('/?uiPreview=1');
 await page.getByRole('button',{name:'You',exact:true}).click();
 await page.getByRole('button',{name:'Connected apps',exact:true}).last().click();
 await page.clock.resume();
 await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.wd-settings-page, .wd-settings-sheet')].some(node=>node.getAnimations().some(animation=>animation.playState==='running'||animation.pending)))).toBe(false);
 await page.evaluate(()=>{const w=window as any;w.chromeReads={style:0,rect:0,raf:0};w.chromePackets=[];});
 await page.clock.runFor(1000);
 const idle=await page.evaluate(()=>(window as any).chromeReads);
 writeFileSync('/tmp/dash-chrome-idle-metrics.json',JSON.stringify(idle));
 // Baseline mode records existing behavior before the implementation changes.
 if(process.env.CHROME_BASELINE==='1')return;
 expect(idle.raf).toBeLessThan(12);
 expect(idle.style).toBeLessThan(40);
 await page.evaluate(()=>window.dispatchEvent(new Event('decisionFeed:sheetLayout')));
 await page.clock.runFor(100);
 expect(await page.evaluate(()=>(window as any).chromeReads.rect)).toBeGreaterThan(idle.rect);
 const controls=await page.evaluate(()=>(window as any).chromePackets.filter((m:any)=>m.action==='browserCloseState'));
 expect(controls.length).toBeLessThan(4);
 await page.clock.resume();
 await page.evaluate(()=>{
  const panel=document.querySelector<HTMLElement>('.wd-settings-content > .wd-settings-page:last-child')!;
  (window as any).chromePackets=[];
  panel.animate([{transform:'translateX(0)'},{transform:'translateX(60px)'}],{duration:240,fill:'forwards'});
  window.dispatchEvent(new Event('decisionFeed:sheetLayout'));
 });
 await expect.poll(()=>page.evaluate(()=>{
  const xs=(window as any).chromePackets.filter((m:any)=>m.action==='browserCloseState').map((m:any)=>m.payload.x);
  return xs.length ? xs.at(-1)-xs[0] : 0;
 })).toBeGreaterThan(40);
 await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.wd-settings-page')].some(node=>node.getAnimations().some(animation=>animation.playState==='running'||animation.pending)))).toBe(false);
 const moving=await page.evaluate(()=>(window as any).chromePackets.filter((m:any)=>m.action==='browserCloseState').map((m:any)=>m.payload.x));
 expect(moving.length).toBeGreaterThan(4);
 expect(moving.at(-1)-moving[0]).toBeGreaterThan(40);
 await page.evaluate(()=>{(window as any).chromeReads={style:0,rect:0,raf:0};});
 await page.clock.runFor(1000);
 expect(await page.evaluate(()=>(window as any).chromeReads.rect)).toBe(0);
});
