import {test,expect} from '@playwright/test';
import{readFileSync}from'node:fs';import{createRequire}from'node:module';
const require=createRequire(import.meta.url);const{buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{TaskRoute}from'./app/task-route';const decision={id:'choice',sourceType:'proactive',title:'Dinner plans',subtitle:'Choose a time for dinner.',category:'travel',createdAt:'2026-10-02T12:00:00Z',options:[{id:'a',label:'6 PM',actionType:'approval'},{id:'b',label:'7 PM',actionType:'approval'}]};createRoot(document.getElementById('root')).render(<div className="wd"><TaskRoute id="choice" decisions={[decision]} tasks={[]} history={[]} snapshots={new Map()} actions={{onBack(){},onDismiss(){},onChoose:()=>new Promise(resolve=>{window.finishChoice=resolve})}}/></div>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test('proactive choice collapse does not start a fake outgoing message or shift the page',async({page})=>{
 await page.route('**/choice-motion-fixture',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('/choice-motion-fixture');
 for(const f of['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(f,'utf8')});await page.addScriptTag({content:bundle});
 const before=await page.locator('.wd-ask-message').boundingBox();
 await page.getByRole('button',{name:'6 PM',exact:true}).click();
 await expect(page.locator('.wd-inline-panel-ghost')).toHaveCount(0);
 const after=await page.locator('.wd-ask-message').boundingBox();expect(Math.abs(after!.y-before!.y)).toBeLessThan(1);
 await expect(page.locator('.wd-user')).toHaveCount(0);
 await page.screenshot({path:'/tmp/dash-proactive-choice-motion.png'});
});
