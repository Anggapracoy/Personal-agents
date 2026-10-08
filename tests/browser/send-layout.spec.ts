import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ stdin: { contents: `import {prepareMessageSend,animateMessageSend} from './app/message-send-motion'; Object.assign(window,{prepareMessageSend,animateMessageSend});`, resolveDir: process.cwd() }, bundle:true, write:false, platform:'browser', format:'iife' }).outputFiles[0].text;
for (const native of [false, true]) test(`send follows changing layout without crossing previous message (${native ? 'native bridge' : 'web'})`, async ({page}) => {
 await page.route('**/send-layout', route => route.fulfill({contentType:'text/html',body:`<style>body{margin:0;font:17px Arial}.wd-task{height:600px;overflow:auto}.wd-thread{padding:20px;display:flex;flex-direction:column;gap:12px}.previous{height:220px;background:#eee;border-radius:20px;padding:16px;box-sizing:border-box}.wd-user-turn{display:flex;justify-content:flex-end}.wd-bubble{padding:12px;background:#008bff;color:white;border-radius:20px}form{position:fixed;top:620px}textarea{width:300px;height:40px}</style><div class="wd"><div class="wd-front-layer"><div class="wd-task"><div class="wd-thread"><div class="previous">Assistant message</div></div></div></div><form><textarea>My reply</textarea></form></div>`}));
 await page.goto('/send-layout'); await page.addScriptTag({content:bundle});
 await page.evaluate(native => {
  const w = window as any; w.messages=[]; w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(m:any)=>w.messages.push(m.payload)}}};
  w.prepareMessageSend(document.querySelector('form'),'My reply',native ? {x:30,y:640,width:300,height:30,nativeFlight:true,nativeFlightId:'test'} : undefined);
  document.querySelector('.wd-thread')!.insertAdjacentHTML('beforeend','<div class="wd-user-turn" data-message-id="new"><div class="wd-bubble is-me">My reply</div></div>');
  w.animateMessageSend(document.querySelector('.wd-task'));
 },native);
 await page.waitForTimeout(120);
 await page.evaluate(()=>{(document.querySelector('.previous') as HTMLElement).style.height='310px';});
 if(native) {
  await expect.poll(()=>page.evaluate(()=>(window as any).messages.filter((m:any)=>m.retarget).length)).toBeGreaterThan(0);
  const geometry=await page.evaluate(()=>({payload:(window as any).messages.filter((m:any)=>m.retarget).at(-1),top:document.querySelector('.wd-bubble')!.getBoundingClientRect().top}));
  expect(geometry.payload.y).toBeCloseTo(geometry.top,1);
 } else {
  const gaps=await page.evaluate(async()=>{const gaps:number[]=[];for(let i=0;i<35;i++){await new Promise(requestAnimationFrame); const flight=document.querySelector('.wd-send-flight'); if(flight) gaps.push(flight.getBoundingClientRect().top-document.querySelector('.previous')!.getBoundingClientRect().bottom);}return gaps;});
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(11.5);
 }
 await page.screenshot({path:`/tmp/dash-send-layout-${native?'native':'web'}.png`});
});
