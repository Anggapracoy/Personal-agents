import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/purchase-approval.tsx'],bundle:true,write:false,jsx:'automatic',format:'iife',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;

test('checkout keeps review, allow, deny and failed-approval feedback at narrow widths',async({page})=>{
 await page.route('**/checkout-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.route('**/api/runs/preview/artifacts/frame',route=>route.fulfill({status:404}));
 await page.route('https://www.google.com/s2/favicons?**',route=>route.fulfill({contentType:'image/png',body:readFileSync('public/dash-icon.png')}));
 await page.route('**/api/runs/preview/browser?control=0',route=>route.fulfill({contentType:'text/html',body:'<p>Checkout review</p>'}));
 await page.goto('/checkout-fixture');
 for(const file of ['app/brand-tokens.css','app/wdyt.css','app/browser-viewer.css'])await page.addStyleTag({content:readFileSync(file,'utf8')});
 await page.addScriptTag({content:bundle});
 await expect(page.getByText('CA$16.78',{exact:true})).toBeVisible();
 await expect(page.getByText('Mastercard •••• 5908')).toBeVisible();
 await expect(page.locator('.wd-checkout-screenshot')).toBeHidden();
 await expect(page.getByText('Order details',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Approval options',{exact:true})).toHaveCount(0);
 await expect(page.locator('.wd-checkout-actions button')).toHaveText(['Allow','Deny']);
 await expect(page.locator('.wd-checkout-merchant img')).toHaveAttribute('src',/domain=naturamarket\.ca/);
 await expect.poll(()=>page.locator('.wd-checkout-merchant img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 await page.screenshot({path:'/tmp/dash-checkout-approval-updated.png'});
 await expect(page.getByRole('button',{name:'Allow',exact:true})).toHaveCSS('background-color','rgb(17, 17, 17)');
 await expect(page.getByRole('button',{name:'Allow',exact:true})).toHaveCSS('color','rgb(255, 255, 255)');
 expect(await page.getByRole('button',{name:'Review order'}).evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36);
 await page.getByRole('button',{name:'Review order'}).click();
 const viewer=page.getByRole('dialog',{name:'Live view for Review checkout'});
 await expect(viewer).toBeVisible();
 await expect(page.locator('.browser-needs-user-overlay')).toHaveCount(0);
 await expect(page.locator('iframe')).toHaveAttribute('src','/api/runs/preview/browser?control=0');
 await expect.poll(()=>viewer.evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).m42)).toBe(0);
 await page.getByRole('button',{name:'Hide browser',exact:true}).last().click();
 await expect(viewer).toHaveCount(0);
 await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
 await page.evaluate(()=>document.documentElement.dataset.appearance='dark');
 await page.getByRole('button',{name:'Review order'}).click();
 await expect(viewer).toBeVisible();
 await expect.poll(()=>viewer.evaluate(e=>getComputedStyle(e).opacity)).toBe('1');
 await page.keyboard.press('Escape');
 await expect(viewer).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Allow',exact:true})).toHaveCSS('background-color','rgb(244, 244, 244)');
 await expect(page.getByRole('button',{name:'Allow',exact:true})).toHaveCSS('color','rgb(0, 0, 0)');
 await page.getByRole('button',{name:'Deny',exact:true}).click();
 await page.evaluate(()=>{
  (window as any).webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:{action:string})=>{
   (window as any).checkoutCalls.push(message.action);
  }}}};
 });
 await page.getByRole('button',{name:'Allow',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('no longer waiting');
 expect(await page.evaluate(()=>(window as any).checkoutCalls)).toEqual(['review','review','deny','hapticSelection','once']);
 await page.setViewportSize({width:320,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
 await expect(page.getByText('Purchase approved')).toBeVisible();
 await expect(page.getByText('Order placed',{exact:true})).toHaveCount(0);
});

test('purchase keeps its established two-button layout with the shared styling', async ({page})=>{
 await page.route('**/checkout-fixture',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.route('**/api/runs/preview/artifacts/*',r=>r.fulfill({status:404,body:''}));
 await page.goto('/checkout-fixture');
 await page.addStyleTag({content:readFileSync('app/brand-tokens.css','utf8')+readFileSync('app/wdyt.css','utf8')});await page.addScriptTag({content:bundle});
 await expect(page.getByText('CA$16.78',{exact:true})).toBeVisible();await expect(page.getByText('Mastercard •••• 5908',{exact:true})).toBeVisible();
 const allow=await page.getByRole('button',{name:'Allow',exact:true}).boundingBox();const deny=await page.getByRole('button',{name:'Deny',exact:true}).boundingBox();
 expect(Math.abs(allow!.y-deny!.y)).toBeLessThan(1);expect(allow!.height).toBeGreaterThanOrEqual(44);
 await expect(page.getByRole('button',{name:'Allow',exact:true})).toHaveCSS('border-radius','14px');
});
