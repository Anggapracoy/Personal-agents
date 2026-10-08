import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/morning-archive.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' } }).outputFiles[0].text;
test.use({hasTouch:true,isMobile:true});
test.beforeEach(async ({page}, info) => {
 if (!info.title.startsWith('long-press Archive') && !info.title.startsWith('native menu Archive')) page.on('dialog', dialog => dialog.accept());
 await page.route('**/__morning-archive-fixture*', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>'}));
 await page.goto('/__morning-archive-fixture'+(info.title.startsWith('declining ')?'?source='+info.title.split(' ')[1]:''));
 for (const path of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({content:readFileSync(path,'utf8')});
 if (info.title.startsWith('native menu Archive')) await page.evaluate(()=>Object.assign(window, {
  __decisionFeedNativeConversationMenus:true, __decisionFeedNativeArchiveConfirmation:true, archiveRequests:[],
  webkit:{messageHandlers:{decisionFeedNative:{postMessage:(m:any)=>{if(m.action==='confirmArchive')(window as any).archiveRequests.push(m.payload); if(m.action==='conversationMenuItems')(window as any).menuItems=m.payload.items;}}}}
 }));
 await page.addScriptTag({content:bundle});
 await expect(page.getByRole('button',{name:'Wait for now',exact:true})).toBeEnabled();
});
test('morning no-action archives without starting a run, stays Home, and is recoverable from Archived',async({page})=>{
 const runs:string[]=[]; page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/runs'))runs.push(r.url());});
 await page.getByRole('button',{name:'Wait for now',exact:true}).click();
 await expect(page.locator('.wd-proactive-item')).toHaveCount(0);
 await expect(page.locator('.wd-front-layer')).toHaveCount(0);
 await expect(page.getByText('Conversation archived',{exact:true})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wdyt-preview-conversations:morning-test@example.com')||'{}')['decision:morning-archive-test']?.archived)).toBe(true);
 expect(runs).toEqual([]);
 await page.getByRole('button',{name:/Archived conversations/}).click();
 await expect(page.locator('.wd-front-layer .wd-row').filter({hasText:'Try pottery'})).toBeVisible();
});
test('morning offers reveal Archive on a partial touch swipe and archive on full swipe',async({page})=>{
 const row=page.locator('.wd-proactive-swipe'), front=row.locator('article');
 const box=(await row.boundingBox())!, y=box.y+45;
 const cdp=await page.context().newCDPSession(page);
 const touch=(type:'touchStart'|'touchMove'|'touchEnd',x=0)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
 await touch('touchStart',350);await touch('touchMove',220);await touch('touchEnd');
 await expect.poll(()=>front.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)).toBe(-82);
 await page.screenshot({path:'/tmp/dash-morning-swipe.png'});
 await touch('touchStart',350);await touch('touchMove',55);await touch('touchEnd');
 await expect(row).toHaveCount(0);
 await page.getByRole('button',{name:/Archived conversations/}).click();
 await expect(page.locator('.wd-front-layer .wd-row').filter({hasText:'Try pottery'})).toBeVisible();
 await cdp.detach();
});
test('morning no-action from its conversation returns Home',async({page})=>{
 await page.getByRole('button',{name:'Open Try pottery',exact:true}).click();
 await page.locator('.wd-front-layer').getByRole('button',{name:'Wait for now',exact:true}).click();
 await expect(page.locator('.wd-front-layer')).toHaveCount(0);
 await expect(page.locator('.wd-proactive-item')).toHaveCount(0);
 await expect(page.getByText('Conversation archived',{exact:true})).toHaveCount(0);
});

test('a failed archive save leaves the morning offer actionable and does not open a chat',async({page})=>{
 await page.evaluate(()=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(key==='wdyt-preview-conversations:morning-test@example.com')throw new Error('Storage temporarily unavailable');return original.call(this,key,value);};
 });
 await page.getByRole('button',{name:'Wait for now',exact:true}).click();
 await expect(page.getByRole('button',{name:'Wait for now',exact:true})).toBeEnabled();
 await expect(page.locator('.wd-proactive-item')).toBeVisible();
 await expect(page.locator('.wd-front-layer')).toHaveCount(0);
 await expect(page.getByText('Conversation archived',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Storage temporarily unavailable',{exact:true})).toBeVisible();
});

test('long-press Archive confirms before removing a suggestion', async ({page}) => {
 const row=page.locator('.wd-proactive-item');
 await row.click({button:'right'});
 let dialogs=0;
 page.once('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
 await page.getByRole('menuitem',{name:'Archive',exact:true}).click();
 await expect.poll(()=>dialogs).toBe(1);
 await expect(row).toHaveCount(1);
 await row.click({button:'right'});
 page.once('dialog', dialog=>dialog.accept());
 await page.getByRole('menuitem',{name:'Archive',exact:true}).click();
 await expect(row).toHaveCount(0);
});

test('native menu Archive uses the shared anchored confirmation', async ({page}) => {
 const row=page.locator('.wd-proactive-item');
 await expect.poll(()=>page.evaluate(()=>(window as any).menuItems?.length)).toBe(1);
 const article=(await row.boundingBox())!;
 const descriptor=await page.evaluate(()=>(window as any).menuItems[0]);
 expect(descriptor.x).toBeCloseTo(article.x,1);
 expect(descriptor.width).toBeCloseTo(article.width,1);
 expect(descriptor.height).toBeCloseTo(article.height,1);
 const options=(await row.locator('.wd-proactive-actions').boundingBox())!;
 expect(descriptor.y+descriptor.height).toBeGreaterThanOrEqual(options.y+options.height);
 const trigger=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('decisionFeed:conversationAction',{detail:{key:'decision:morning-archive-test',action:'archive'}})));
 await trigger();
 await expect.poll(()=>page.evaluate(()=>(window as any).archiveRequests.length)).toBe(1);
 await expect(row).toHaveCount(1);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('decisionFeed:archiveConfirmation',{detail:{requestId:(window as any).archiveRequests[0].requestId,confirmed:false}})));
 await expect(row).toHaveCount(1);
 await trigger();
 await expect.poll(()=>page.evaluate(()=>(window as any).archiveRequests.length)).toBe(2);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('decisionFeed:archiveConfirmation',{detail:{requestId:(window as any).archiveRequests[1].requestId,confirmed:true}})));
 await expect(row).toHaveCount(0);
});

for(const source of ['email','calendar','recurring','proactive']) test(`declining ${source} archives smoothly without a toast`,async({page})=>{
 const row=page.locator('.wd-proactive-swipe');
 const original=(await row.boundingBox())!;
 const height=original.height;
 await page.getByRole('button',{name:'Wait for now',exact:true}).click();
 await expect.poll(()=>row.evaluate(el=>(el as HTMLElement).inert)).toBe(true);
 expect((await row.boundingBox())!.height).toBeGreaterThan(0);
 expect((await row.locator('article').boundingBox())!.x).toBeCloseTo(original.x,1);
 expect((await row.boundingBox())!.height).toBeLessThanOrEqual(height);
 await expect(row).toHaveCount(0);
 await expect(page.getByText('Conversation archived',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/Archived conversations/}).click();
 await expect(page.locator('.wd-front-layer .wd-row').filter({hasText:'Try pottery'})).toBeVisible();
});
