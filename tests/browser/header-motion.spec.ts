import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/header-motion.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test('new messages show Thinking during send while header collapse keeps the thread stationary',async({page})=>{
 await page.route('**/header-motion-fixture', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })); await page.goto('/header-motion-fixture');
 await page.addStyleTag({content:readFileSync('app/brand-tokens.css','utf8')}); await page.addStyleTag({content:readFileSync('app/wdyt.css','utf8')}); await page.evaluate(()=>{(window as any).__decisionFeedNativeChatHeader=true;(window as any).headerBridge=[];(window as any).webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>(window as any).headerBridge.push(message)}}};}); await page.addScriptTag({content:bundle});
 await expect(page.locator(".wd-task")).toBeVisible();
 await page.evaluate(()=>(window as any).headerTest.photos());
 await expect(page.locator('.wd-chat-activity')).toHaveText('Preparing photos');
 await expect(page.locator('[data-activity-icon]')).toHaveAttribute('data-activity-icon','photo');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('[data-activity-icon]')).toHaveCount(0);
 await expect(page.locator('.wd-send-flight')).toHaveCount(1);
 await expect(page.locator('.wd-chat-activity')).toHaveText('Thinking');
 await page.waitForTimeout(100);
 await expect(page.locator('.wd-send-flight')).toHaveCount(1);
 await expect(page.locator('.wd-chat-activity')).toHaveText('Thinking');
 await expect(page.locator('.wd-send-flight')).toHaveCount(0);
 await expect(page.locator('.wd-chat-activity')).toHaveText('Thinking');
 await page.evaluate(()=>(window as any).headerTest.typing());
 await expect(page.locator('.wd-chat-activity')).toHaveText('Typing');
 await expect(page.locator('[data-activity-icon]')).toHaveCount(0);
 await page.screenshot({path:'/tmp/dash-typing-no-icon.png'});
 await page.waitForTimeout(250);
 const samples=await page.evaluate(async()=>{
  const positions:{top:number;at:number}[]=[];const started=performance.now();(window as any).headerTest.stop();
  await new Promise<void>(resolve=>{const tick=()=>{positions.push({top:document.querySelector('.wd-thread')!.getBoundingClientRect().top,at:performance.now()});if(performance.now()-started<300)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});return positions;
 });
 expect(Math.max(...samples.map(value=>value.top))-Math.min(...samples.map(value=>value.top))).toBeLessThan(1);
 const bridge=await page.evaluate(()=>(window as any).headerBridge);
 expect(bridge.filter((message:any)=>message.action==='chatHeaderHide')).toHaveLength(0);
 expect(new Set(bridge.filter((message:any)=>message.action==='chatHeaderState').map((message:any)=>Math.round(message.payload.label.height))).size).toBeGreaterThan(4);
 await page.screenshot({path:'/tmp/dash-header-motion.png'});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>(window as any).headerTest.start());
 await expect(page.locator('.wd-chat-activity-slot')).toHaveCSS('transition-duration','0s');
});

for (const position of ['short', 'bottom', 'history'] as const) test(`activity changes keep messages stationary in ${position} conversations`, async ({ page }) => {
 await page.route('**/header-motion-fixture', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })); await page.goto('/header-motion-fixture');
 for (const file of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({content:readFileSync(file,'utf8')});
 await page.addScriptTag({content:bundle});
 await expect(page.locator(".wd-task")).toBeVisible();
 if(position !== 'short') await page.evaluate(()=>(window as any).headerTest.history());
 await page.waitForTimeout(350);
 if(position === 'history') await page.locator('.wd-task').evaluate(el=>el.scrollTop=el.scrollHeight/2);
 for (const reduced of [false,true]) {
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  const measurements=await page.evaluate(async()=>{
   const screen=document.querySelector('.wd-task')!;
   const messages=[...screen.querySelectorAll('.wd-agent, .wd-bubble.is-me')];
   const message=messages.find(el=>{const r=el.getBoundingClientRect();return r.top>screen.querySelector('.wd-taskbar')!.getBoundingClientRect().bottom&&r.bottom<window.innerHeight-100;}) ?? messages[0];
   const measure=()=>({message:message.getBoundingClientRect().top,header:screen.querySelector('.wd-taskbar')!.getBoundingClientRect().height,scroll:screen.scrollTop});
   const positions=[measure()];
   for (const action of ['start','maps','stop']) {
    (window as any).headerTest[action]();
    const start=performance.now();
    await new Promise<void>(resolve=>{const tick=()=>{positions.push(measure());if(performance.now()-start<300)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
   }
   return positions;
  });
  for(const field of ['message','header','scroll'] as const) expect(Math.max(...measurements.map(m=>m[field]))-Math.min(...measurements.map(m=>m[field]))).toBeLessThan(1);
 }
});

test('native header follows viewport settling after the last scroll event', async ({ page }) => {
 await page.route('**/header-motion-fixture', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
 await page.goto('/header-motion-fixture');
 for (const file of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
 await page.evaluate(() => {
  (window as any).__decisionFeedNativeChatHeader = true;
  (window as any).headerBridge = [];
  (window as any).webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => (window as any).headerBridge.push(message) } } };
 });
 await page.addScriptTag({ content: bundle });
 await expect(page.locator('.wd-taskbar-title')).toBeVisible();
 await page.waitForTimeout(700);
 // Position changes do not resize the header. WebKit can settle its position
 // after the final viewport event, leaving a one-shot measurement stale.
 await page.evaluate(async () => {
  const header = document.querySelector<HTMLElement>('.wd-taskbar')!;
  header.style.translate = '0 -62px';
  window.visualViewport!.dispatchEvent(new Event('scroll'));
  await new Promise(resolve => setTimeout(resolve, 70));
  header.style.translate = '';
 });
 await expect.poll(() => page.evaluate(() => {
  const messages = (window as any).headerBridge.filter((m: any) => m.action === 'chatHeaderState');
  const label = document.querySelector('.wd-taskbar-title strong')!.getBoundingClientRect();
  const back = document.querySelector('.wd-chat-back')!.getBoundingClientRect();
  const latest = messages.at(-1).payload;
  return Math.max(Math.abs(latest.label.y - label.y), Math.abs(latest.back.y - back.y));
 })).toBeLessThan(1);
});

test('native glass height stays unchanged when the chat is skewed', async ({page}) => {
 await page.route('**/header-motion-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/header-motion-fixture');
 for(const file of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({content:readFileSync(file,'utf8')});
 await page.evaluate(()=>{(window as any).__decisionFeedNativeChatHeader=true;(window as any).headerBridge=[];(window as any).webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>(window as any).headerBridge.push(message)}}};});
 await page.addScriptTag({content:bundle});
 await expect(page.locator('.wd-task')).toBeVisible();
 await page.evaluate(()=>(window as any).headerTest.photos());
 await page.waitForTimeout(700);
 const measurements=await page.evaluate(async()=>{
  const layer=document.querySelector<HTMLElement>('.wd-front-layer')!;
  const label=document.querySelector<HTMLElement>('.wd-taskbar-title strong')!;
  const latest=()=>[...(window as any).headerBridge].reverse().find(m=>m.action==='chatHeaderState').payload.label;
  const baseline=latest(); const samples=[];
  for(const angle of [14,-14,0]) {
   layer.style.transform=`skewY(${angle}deg)`;
   window.dispatchEvent(new Event('resize'));
   await new Promise(resolve=>setTimeout(resolve,80));
   samples.push({native:latest(),web:label.getBoundingClientRect().toJSON()});
  }
  return {baseline,samples};
 });
 for(const {native,web} of measurements.samples){
  expect(native.height).toBeCloseTo(measurements.baseline.height,1);
  expect(native.y+native.height/2).toBeCloseTo(web.y+web.height/2,1);
 }
});
