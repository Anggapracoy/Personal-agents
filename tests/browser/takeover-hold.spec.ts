import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const swift=readFileSync('ios/DecisionFeed/Web/WebCoordinator.swift','utf8');
const script=swift.split('enum BrowserTakeoverTouch {')[1].split('static let script = #"""')[1].split('"""#')[0];
async function setup(page:any,host='production-sfo.browserless.io',path='/e/53616c7465645f5f0123456789abcdef/live/index.html') {
 await page.route(`https://${host}${path}`, (route:any)=>route.fulfill({contentType:'text/html',body:'<canvas id="browserless-screen" width="350" height="500" tabindex="0"></canvas>'}));
 await page.addInitScript(script);
 await page.goto(`https://${host}${path}`);
 await page.evaluate(()=>{
  const w=window as any; w.events=[];
  const canvas=document.querySelector('canvas')!; let touch=false;let dragged=false;
  // Mirror the provider's mobile release-only click versus mouse down/up.
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])canvas.addEventListener(type,(event:any)=>{
   if(event.pointerType==='touch') {
    if(type==='pointerdown'){touch=true;dragged=false;}
    if(type==='pointermove' && touch){dragged=true;w.events.push('scroll');}
    if(type==='pointerup' && touch && !dragged)w.events.push('tap');
    if(type==='pointercancel'||type==='pointerup')touch=false;
   }else w.events.push(type);
  });
 });
}
const down={pointerId:1,pointerType:'touch',isPrimary:true,clientX:100,clientY:100,button:0,bubbles:true};
test('hold stays down until release, without copy menu or duplicate tap',async({page})=>{
 await setup(page);const canvas=page.locator('canvas');
 await canvas.dispatchEvent('pointerdown',down);
 await page.waitForTimeout(700);
 expect(await page.evaluate(()=>(window as any).events)).toEqual(['pointerdown']);
 expect(await canvas.evaluate(el=>getComputedStyle(el).userSelect)).toBe('none');
 expect(await canvas.evaluate(el=>el.dispatchEvent(new Event('contextmenu',{bubbles:true,cancelable:true})))).toBe(false);
 await canvas.dispatchEvent('pointerup',down);
 expect(await page.evaluate(()=>(window as any).events)).toEqual(['pointerdown','pointerup']);
});
test('tap, swipe and cancellation keep their normal semantics',async({page})=>{
 await setup(page);const c=page.locator('canvas');
 await c.dispatchEvent('pointerdown',down);await c.dispatchEvent('pointerup',down);
 await c.dispatchEvent('pointerdown',down);await c.dispatchEvent('pointermove',{...down,clientY:130});await c.dispatchEvent('pointerup',{...down,clientY:130});
 await page.waitForTimeout(300);
 expect(await page.evaluate(()=>(window as any).events)).toEqual(['tap','scroll']);
 await c.dispatchEvent('pointerdown',down);await page.waitForTimeout(300);await c.dispatchEvent('pointercancel',down);
 expect(await page.evaluate(()=>(window as any).events)).toEqual(['tap','scroll','pointerdown','pointerup']);
});
test('does not alter unrelated website canvases',async({page})=>{
 await setup(page,'example.com'); const c=page.locator('canvas');await c.dispatchEvent('pointerdown',down);await page.waitForTimeout(300);await c.dispatchEvent('pointerup',down);
 expect(await page.evaluate(()=>(window as any).events)).toEqual(['tap']);
});

test('real touch retains pointer capture for the full hold',async({page,context})=>{
 await setup(page);
 await page.evaluate(()=>document.querySelector('canvas')!.addEventListener('pointerdown',(e:any)=>{document.querySelector('canvas')!.setPointerCapture(e.pointerId);}));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:100}]});
 await page.waitForTimeout(800);
 expect(await page.evaluate(()=>(window as any).events)).toEqual(['pointerdown']);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>page.evaluate(()=>(window as any).events)).toEqual(['pointerdown','pointerup']);
 expect(errors).toEqual([]);
});

for (const path of ['/live/', '/live', '/chromium/live/index.html']) {
 test(`hold adapter supports viewer route ${path}`,async({page})=>{
  await setup(page,'production-sfo.browserless.io',path);
  const c=page.locator('canvas');await c.dispatchEvent('pointerdown',down);
  await page.waitForTimeout(350);await c.dispatchEvent('pointerup',down);
  expect(await page.evaluate(()=>(window as any).events)).toEqual(['pointerdown','pointerup']);
 });
}
for (const path of ['/settings', '/e/not-a-route/live/index.html', '/live-other']) {
 test(`does not alter non-viewer route ${path}`,async({page})=>{
  await setup(page,'production-sfo.browserless.io',path);
  const c=page.locator('canvas');await c.dispatchEvent('pointerdown',down);
  await page.waitForTimeout(350);await c.dispatchEvent('pointerup',down);
  expect(await page.evaluate(()=>(window as any).events)).toEqual(['tap']);
 });
}
