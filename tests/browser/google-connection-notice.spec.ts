import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/google-connection-notice.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test('Home exposes broken Google discovery and clears the notice after reconnection',async({page})=>{
 let needsReconnect=true;
 await page.route('**/api/connections',route=>route.fulfill({json:{accounts:[{id:'google-test',email:'lisa@example.com',name:'Lisa',enabled:true,needsReconnect,connectedAt:'2026-09-09T00:00:00Z'}]}}));
 await page.route('**/google-health-fixture',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
 await page.goto('/google-health-fixture');
 for(const path of ['app/brand-tokens.css','app/wdyt.css','public/ink-glass.css'])await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
 const notice=page.getByRole('region',{name:'Google connection needs attention',exact:true});
 await expect(notice).toBeVisible();
 await expect(notice).toContainText('Dash can’t check Gmail or Calendar for lisa@example.com until you reconnect.');
 await expect(notice.getByRole('link',{name:'Reconnect',exact:true})).toHaveAttribute('href','/api/connections/google/start');
 await expect(page.getByText('Message your assistant below. Your conversations will stay here.',{exact:true})).toBeHidden();
 await page.screenshot({path:'/tmp/dash-google-reconnect-full-button.png'});
 needsReconnect=false;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(notice).toHaveCount(0);
});

test('Reconnect uses the existing native Google flow and refreshes the notice after completion',async({page})=>{
 let needsReconnect=true;
 await page.addInitScript(()=>{
  const w=window as any;
  w.__decisionFeedNativeGoogleConnectionCompletion=true;
  w.nativeConnectionMessages=[];
  w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>{if(message.action==='reconnectGoogle')w.nativeConnectionMessages.push(message);}}}};
 });
 await page.route('**/api/connections',route=>route.fulfill({json:{accounts:[{id:'google-test',email:'lisa@example.com',name:'Lisa',enabled:true,needsReconnect,connectedAt:'2026-09-09T00:00:00Z'}]}}));
 await page.route('**/api/mobile/onboarding/google',async route=>{
  expect(route.request().headers()['x-dash-google-connection-completion']).toBe('1');
  await route.fulfill({json:{connectionId:'onboarding-test',authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=test'}});
 });
 await page.route('**/google-health-fixture',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
 await page.goto('/google-health-fixture');
 for(const path of ['app/brand-tokens.css','app/wdyt.css','public/ink-glass.css'])await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
 await page.getByRole('link',{name:'Reconnect',exact:true}).click();
 await expect(page.getByRole('link',{name:'Connecting…',exact:true})).toHaveAttribute('aria-busy','true');
 await expect.poll(()=>page.evaluate(()=>(window as any).nativeConnectionMessages.length)).toBe(1);
 expect(page.url()).toContain('/google-health-fixture');
 needsReconnect=false;
 await page.evaluate(()=>{
  const payload=(window as any).nativeConnectionMessages[0].payload;
  window.dispatchEvent(new CustomEvent('decisionFeed:googleReconnectResult',{detail:{requestId:payload.requestId,runId:payload.runId,ok:true}}));
 });
 await expect(page.getByRole('region',{name:'Google connection needs attention',exact:true})).toHaveCount(0);
});
