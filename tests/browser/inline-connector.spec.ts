import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/inline-connector.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
async function mount(page:any){
 await page.route('**/inline-connector-fixture', (r:any)=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}));
 await page.goto('/inline-connector-fixture');
 for(const path of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
}
test('inline connect retries errors, verifies connection and resumes once; captures both states',async({page})=>{
 let connected=false,starts=0;
 await page.route('**/api/runs/test/connection*',async route=>{
  if(route.request().method()==='POST'){
   if(++starts===1)return route.fulfill({status:502,json:{error:'Couldn’t connect. Try again.'}});
   connected=true;
  }
  await route.fulfill({json:{connected}});
 });
 await mount(page);
 await expect(page.getByRole('button',{name:'Connect Notion'})).toBeVisible();
 await expect(page.locator('.wd-connect-app-icon img')).toHaveJSProperty('complete',true);
 await page.screenshot({path:'/tmp/dash-inline-connection.png'});
 await page.getByRole('button',{name:'Connect Notion'}).click();
 await expect(page.getByRole('alert')).toHaveText('Couldn’t connect. Try again.');
 await expect(page.getByLabel('Notion Connected',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Connect Notion'}).click();
 await expect(page.getByLabel('Notion Connected',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 expect(await page.evaluate(()=>(window as any).resumes)).toBe(1);
 await page.screenshot({path:'/tmp/dash-inline-connected.png'});
});
test('Not now skips without starting sign-in',async({page})=>{
 let starts=0;
 await page.route('**/api/runs/test/connection*',r=>{if(r.request().method()==='POST')starts++;return r.fulfill({json:{connected:false}});});
 await mount(page);
 await page.getByRole('button',{name:'Not now'}).click();
 await expect(page.getByLabel('Notion Skipped',{exact:true})).toBeVisible();
 expect(starts).toBe(0);
});
test('returning from hosted sign-in verifies and resumes from pending card',async({page})=>{
 let connected=false;
 await page.route('**/api/runs/test/connection*',r=>r.fulfill({json:{connected}}));
 await mount(page);
 await expect(page.getByRole('button',{name:'Connect Notion'})).toBeVisible();
 connected=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByLabel('Notion Connected',{exact:true})).toBeVisible();
});
test('verified native connector closes its browser before resuming, never while pending',async({page})=>{
 let connected=false;
 const url='https://connect.composio.dev/link/test';
 await page.route('**/api/runs/test/connection*',r=>r.fulfill({json:r.request().method()==='POST'?{url}:{connected}}));
 // Native navigation opens a sheet and leaves the underlying document mounted.
 await page.route(url,r=>r.fulfill({status:204}));
 await mount(page);
 await page.evaluate(()=>{(window as any).nativeMessages=[];(window as any).webkit={messageHandlers:{decisionFeedNative:{postMessage:(m:any)=>(window as any).nativeMessages.push(m)}}};});
 await page.getByRole('button',{name:'Connect Notion'}).click();
 await expect(page.getByRole('status')).toContainText('Finish signing in');
 expect(await page.evaluate(()=>(window as any).nativeMessages)).toEqual([]);
 connected=true;
 // The poll, not a manual browser dismissal/focus event, completes the flow.
 await expect(page.getByLabel('Notion Connected',{exact:true})).toBeVisible({timeout:10000});
 expect(await page.evaluate(()=>(window as any).nativeMessages)).toEqual([{version:1,action:'closeConnectorBrowser',payload:{url}}]);
 expect(await page.evaluate(()=>(window as any).resumes)).toBe(1);
});
