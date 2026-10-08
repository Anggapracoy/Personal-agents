import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/connectors.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test('Apple Connect requests access directly while the name opens details',async({page})=>{
 await page.route('**/connectors-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/connectors-fixture');
 for(const path of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
 const row=page.locator('.wd-source-detail').filter({has:page.locator('summary strong',{hasText:'Contacts'})});
 await row.locator('summary button').click();
 await expect(row).not.toHaveAttribute('open');
 await expect(row.locator('summary')).toContainText('✓');
 expect(await page.evaluate(()=>(window as any).appleRequests.length)).toBe(1);
 await row.locator('summary strong').click();
 await expect(row).toHaveAttribute('open');
 await expect(row.getByRole('button',{name:/Disconnect/})).toBeVisible();
});
test('inline app catalog loads, searches, paginates, enables and disconnects',async({page})=>{
 let requests=0, enabled=false;
 const item=(slug:string,name:string)=>({slug,name,noAuth:true,connected:enabled,accounts:[]});
 await page.route('**/api/connections/composio*',async route=>{
  if(new URL(route.request().url()).searchParams.has("count")) return route.fulfill({json:{connectedCount:0}});
  requests++;
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST'||request.method()==='DELETE'){enabled=request.method()==='POST';return route.fulfill({json:{connected:enabled}});}
  return route.fulfill({json:{configured:true,items:url.searchParams.get('search')?[item('hackernews','Hacker News')]:url.searchParams.get('cursor')?[item('linear','Linear')]:['Notion','Slack','GitHub','Spotify','Todoist'].map(name=>({...item(name.toLowerCase(),name),noAuth:false,logo:`https://logos.composio.dev/api/${name.toLowerCase()}`})),cursor:url.searchParams.get('cursor')||url.searchParams.get('search')?null:'page2'}});
 });
 await page.route('**/connectors-fixture?catalog=1',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/connectors-fixture?catalog=1');
 for(const path of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
 await page.route('**/api/connections',r=>r.fulfill({json:{accounts:[]}}));
 await expect.poll(()=>requests).toBeGreaterThan(0);
 await expect(page.getByText('Notion',{exact:true})).toBeVisible();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 await page.screenshot({path:'/tmp/dash-connectors-entry.png'});
 await page.locator('.wd-connector-catalog').scrollIntoViewIfNeeded();
 await expect(page.getByText('Notion',{exact:true})).toBeVisible();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 await expect(page.locator('.wd-connector-logo').first()).toHaveJSProperty('complete',true);
 await page.screenshot({path:'/tmp/dash-connectors-catalog.png'});
 await page.locator('.wd-connector-sentinel').scrollIntoViewIfNeeded();
 await expect(page.getByRole('button',{name:'Show more'})).toHaveCount(0);
 await expect(page.getByText('Linear',{exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'Search apps'}).fill('hacker');
 await expect(page.getByText('Notion',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Hacker News',{exact:true})).toBeVisible();
 await page.locator('.wd-connector-row').getByRole('button',{name:'Enable',exact:true}).click();
 await page.getByRole('button',{name:'Hacker News Connected',exact:true}).click();
 await expect(page.locator('.wd-connector-row').getByRole('button',{name:'Disconnect',exact:true})).toBeVisible();
 await page.locator('.wd-connector-row').getByRole('button',{name:'Disconnect',exact:true}).click();
 await expect(page.locator('.wd-connector-row').getByRole('button',{name:'Enable',exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/dash-connectors-settings.png',fullPage:true});
});

test('missing connector has a neutral empty state; service errors remain retryable',async({page})=>{
 await page.route('**/api/connections/composio*',route=>{
  const q=new URL(route.request().url()).searchParams;
  if(q.has('count'))return route.fulfill({json:{connectedCount:0}});
  if(q.get('search')==='broken')return route.fulfill({status:502,json:{error:"Couldn't load connectors. Try again."}});
  return route.fulfill({json:{configured:true,items:[],cursor:null}});
 });
 await page.route('**/connectors-fixture?catalog=1',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/connectors-fixture?catalog=1');
 for(const path of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
 await page.getByRole('searchbox',{name:'Search apps'}).fill('missing');
 await expect(page.getByText('We don’t have that app yet.')).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByRole('searchbox').fill('broken');
 await expect(page.getByRole('alert')).toBeVisible();
 await expect(page.getByText('We don’t have that app yet.')).toHaveCount(0);
});
test('adding another native connector account waits for the new active account before dismissing',async({page})=>{
 let added=false;
 const url='https://connect.composio.dev/link/second-account';
 await page.route(url,r=>r.fulfill({status:204}));
 await page.route('**/api/connections/composio*',r=>{
  if(r.request().method()==='POST')return r.fulfill({json:{url}});
  return r.fulfill({json:{configured:true,items:[{slug:'notion',name:'Notion',connected:true,noAuth:false,accounts:[{id:'old',label:'Existing',status:'ACTIVE'},...(added?[{id:'new',label:'New',status:'ACTIVE'}]:[])]}],cursor:null}});
 });
 await page.route('**/connectors-fixture?catalog=1',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/connectors-fixture?catalog=1');
 for(const path of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
 await page.evaluate(()=>{(window as any).nativeMessages=[];(window as any).webkit={messageHandlers:{decisionFeedNative:{postMessage:(m:any)=>(window as any).nativeMessages.push(m)}}};});
 await page.getByRole('button',{name:'Notion 1 account',exact:true}).click();
 await page.getByRole('button',{name:'Add account',exact:true}).click();
 await expect(page.locator('.wd-connector-account').filter({hasText:'Existing'})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 expect(await page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.action==='closeConnectorBrowser'))).toEqual([]);
 added=true;
 await expect(page.locator('.wd-connector-account').filter({hasText:'New'})).toBeVisible({timeout:10000});
 expect(await page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.action==='closeConnectorBrowser'))).toEqual([{version:1,action:'closeConnectorBrowser',payload:{url}}]);
});
