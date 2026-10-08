import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/email-review.tsx'],bundle:true,write:false,jsx:'automatic',format:'iife',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test('email module has explicit Send only and renders its actual preview',async({page})=>{
 await page.setViewportSize({width:393,height:852});
 await page.route('**/email-review-preview',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/email-review-preview');
 for(const file of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(file,'utf8')});
 await page.addScriptTag({content:bundle});
 await expect(page.getByRole('button',{name:'Always allow',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Don’t send',exact:true})).toBeVisible();
 await page.locator('.wd-card').screenshot({path:'/tmp/dash-email-review-updated.png'});
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('body')).toHaveAttribute('data-approval-mode','once');
});
