import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/conversation-preview-race.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test('reply received in chat appears on Home immediately and survives an older poll',async({page})=>{
 let count=0,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/conversations',async route=>{
  count++; if(count===2)await gate;
  await route.fulfill({json:{settings:{},messages:{'run:test':{kind:'agent',text:count===3?'Your table is booked.':'I’m checking tables.',createdAt:count===3?'2026-10-05T14:00:02Z':'2026-10-05T14:00:01Z'}}}});
 });
 await page.route('**/__preview-race',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/__preview-race');await page.addScriptTag({content:bundle});
 await expect(page.getByRole('status')).toHaveText('Ready');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>count).toBe(2);
 await page.getByRole('button',{name:'Receive reply'}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.getByText('Your table is booked.',{exact:true})).toBeVisible();
 release(); await page.waitForTimeout(150);
 for(const expected of [3,4]){
  const response=page.waitForResponse(r=>r.url().endsWith('/api/conversations'));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await response;
  await expect.poll(()=>count).toBe(expected);await page.waitForTimeout(100);
  await expect(page.getByText('Your table is booked.',{exact:true})).toBeVisible();
 }
 await expect(page.getByText('Your table is booked.',{exact:true})).toBeVisible();
});
