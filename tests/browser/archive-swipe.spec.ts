import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/archive-row.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
test.use({ hasTouch: true, isMobile: true });

test('repeated partial archive swipes regrab the row and settle completely', async ({ page }) => {
  await page.route('**/?uiPreview=1', route => route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
  await page.goto('/?uiPreview=1');
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  await page.addScriptTag({ content: bundle });
  const row = page.locator('.wd-swipe-row'), front = row.locator('.wd-row');
  await expect(front).toBeVisible();
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const input = await page.context().newCDPSession(page);
  const x = () => front.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', px = 0) => input.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y }] });
  for (let i = 0; i < 5; i++) {
    await touch('touchStart', 320); await touch('touchMove', 200); await touch('touchMove', 313); await touch('touchEnd');
    // Grab near the trailing edge while the first release is still settling.
    await touch('touchStart', 350); await touch('touchMove', 220);
    expect(await x()).toBeLessThan(-100);
    await touch('touchMove', 355); await touch('touchEnd');
    await expect.poll(x, { timeout: 1200 }).toBe(0);
    await expect(row).toHaveAttribute('data-swipe', 'closed');
    await expect(page.locator('body')).not.toHaveAttribute('data-archived', 'true');
    await expect(page.locator('body')).not.toHaveAttribute('data-opened', 'true');
  }
  await touch('touchStart', 350); await touch('touchMove', 320);
  const symbol = row.locator('.wd-swipe-symbol');
  expect(Number(await symbol.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(.5);
  await page.screenshot({path:'/tmp/dash-swipe-motion-small.png'});
  await touch('touchMove', 100);
  expect((await symbol.boundingBox())!.width).toBeGreaterThan(150);
  await page.screenshot({path:'/tmp/dash-swipe-motion-pill.png'});
  await touch('touchMove', 200); await page.waitForTimeout(120); await touch('touchEnd');
  await expect.poll(x).toBe(-82);
  await expect(page.locator(".wd-swipe-symbol")).toHaveCSS("background-color", "rgb(255, 57, 60)");
  await expect(front).toHaveCSS("border-radius", "24px");
  await page.screenshot({path:"/tmp/dash-messages-archive-swipe.png"});
  page.once('dialog', dialog => dialog.dismiss());
  await row.locator('.wd-swipe-action').click();
  await expect.poll(x).toBe(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-archived', 'true');
  await touch('touchStart', 350); await touch('touchMove', 200); await touch('touchEnd');
  await expect.poll(x).toBe(-82);
  page.once('dialog', dialog => dialog.accept());
  // A second swipe can start in the revealed action strip as well as the front.
  await touch('touchStart', 365); await touch('touchMove', 90); await touch('touchEnd');
  await expect(page.locator('body')).toHaveAttribute('data-archived', 'true');
  await input.detach();
});

test('native confirmation waits for the swipe to settle and keeps removal recoverable', async ({ page }) => {
  await page.route('**/?uiPreview=1', route => route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
  await page.goto('/?uiPreview=1');
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({content:readFileSync(file,'utf8')});
  await page.evaluate(() => {
    Object.assign(window, {__decisionFeedNativeArchiveConfirmation:true, webkit:{messageHandlers:{decisionFeedNative:{postMessage:(message: {action:string;payload:unknown}) => {
      if(message.action==='confirmArchive') Object.assign(window,{confirmationRequest:message.payload,confirmationElapsed:performance.now()-(window as any).archiveTappedAt});
    }}}}});
  });
  await page.addScriptTag({content:bundle});
  const row=page.locator('.wd-swipe-row');
  await row.locator('.wd-row').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(()=>row.locator('.wd-row').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)).toBe(-82);
  await page.evaluate(()=>document.querySelector('.wd-swipe-action')!.addEventListener('click',()=>{(window as any).archiveTappedAt=performance.now();},{capture:true}));
  await row.locator('.wd-swipe-action').click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {confirmationRequest?:unknown}).confirmationRequest))).toBe(true);
  const elapsed=await page.evaluate(()=>(window as any).confirmationElapsed);
  expect(elapsed).toBeGreaterThanOrEqual(250);
  expect(elapsed).toBeLessThan(400);
  const offset=await row.locator('.wd-row').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  expect(offset).toBe(-(await row.evaluate(el => el.clientWidth)));
  await expect(row.locator('.wd-swipe-symbol')).toHaveCSS('background-color','rgb(233, 233, 235)');
  await expect(page.locator('body')).not.toHaveAttribute('data-archived','true');
  await page.screenshot({path:'/tmp/dash-swipe-confirmation-settled.png'});
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('decisionFeed:archiveConfirmation',{detail:{...(window as unknown as {confirmationRequest:object}).confirmationRequest,confirmed:false}})));
  await expect(row).toHaveAttribute('data-swipe','closed');
  await expect(page.locator('body')).not.toHaveAttribute('data-archived','true');
});

test('confirmed swipe finishes sideways then moves the following row smoothly upward',async({page})=>{
 await page.route('**/__archive-collapse',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/__archive-collapse');
 for(const file of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(file,'utf8')});
 await page.addScriptTag({content:bundle});
 const row=page.locator('.wd-swipe-row'),next=page.locator('[data-next-row]');
 const before=(await next.boundingBox())!.y,height=(await row.boundingBox())!.height;
 await row.locator('.wd-row').focus();await page.keyboard.press('ArrowLeft');
 await expect(row).toHaveAttribute('data-swipe','open');
 await page.evaluate(()=>{
  (window as any).positions=[];const started=performance.now();
  const sample=()=>{(window as any).positions.push(document.querySelector('[data-next-row]')!.getBoundingClientRect().top);if(performance.now()-started<1200)requestAnimationFrame(sample);};requestAnimationFrame(sample);
 });
 page.once('dialog',dialog=>dialog.accept());await row.locator('.wd-swipe-action').click();
 await expect(page.locator('body')).toHaveAttribute('data-archived','true');
 const after=(await next.boundingBox())!.y;
 expect(after).toBeCloseTo(before-height,1);
 const positions:number[]=await page.evaluate(()=>(window as any).positions);
 expect(positions.some(y=>y>after+2&&y<before-2)).toBe(true);
 for(let i=1;i<positions.length;i++)expect(positions[i]).toBeLessThanOrEqual(positions[i-1]+.5);
});
