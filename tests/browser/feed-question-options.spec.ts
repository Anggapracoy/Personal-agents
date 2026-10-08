import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);const{buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ProactiveRow}from'./app/home';createRoot(document.getElementById('root')).render(<div className="wd"><ProactiveRow item={{id:'run',title:'Dinner',kind:'other',state:'need',line:'',feedQuestion:{actionId:'a',questionId:'q',multiple:window.multi,moreOptions:true},proactive:{context:'Needs you',body:'Which times work?',option:{id:'a',label:'6 PM'},alternative:{id:'b',label:'7 PM'}}}} enabled onMenu={()=>{}} onOpen={()=>{document.body.dataset.opened='true'}} onChoose={async(ids)=>{document.body.dataset.chosen=JSON.stringify(ids??['a']);return true;}} onAlternative={async()=>{document.body.dataset.chosen='["b"]';return true;}}/></div>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
for(const multi of [false,true])test(`feed answers stay on feed (${multi?'multi':'single'})`,async({page})=>{
 await page.route('**/feed-choice-preview',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('/feed-choice-preview');await page.evaluate(multi=>{(window as any).multi=multi},multi);
 await page.addStyleTag({content:readFileSync('app/brand-tokens.css','utf8')});await page.addStyleTag({content:readFileSync('app/wdyt.css','utf8')});await page.addScriptTag({content:bundle});
 await page.getByRole('button',{name:'6 PM',exact:true}).click();
 if(multi){await expect(page.locator('body')).not.toHaveAttribute('data-chosen');await page.getByRole('button',{name:'7 PM',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-chosen','["a","b"]');}
 else await expect(page.locator('body')).toHaveAttribute('data-chosen','["a"]');
 await expect(page.locator('body')).not.toHaveAttribute('data-opened');await page.screenshot({path:'/tmp/dash-feed-question.png'});
 await page.getByRole('button',{name:'More choices',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-opened','true');
});
