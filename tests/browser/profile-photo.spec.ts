import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import sharp from 'sharp';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/profile-photo.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test('settings pencil opens picker, preserves photo on failure, then updates both settings pages',async({page})=>{
 await page.route('**/profile-photo-fixture',r=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}));
 await page.route('**/api/connections/composio*',r=>r.fulfill({json:{connectedCount:0}}));
 await page.route('**/api/connections',r=>r.fulfill({json:{accounts:[]}}));
 await page.route('**/api/billing',r=>r.fulfill({json:{enabled:false}}));
 await page.goto('/profile-photo-fixture');
 for(const path of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.addScriptTag({content:bundle});
 let fail=true;
 const bytes=await sharp({create:{width:400,height:300,channels:3,background:'#5599bb'}}).png().toBuffer();
 const saved=`data:image/jpeg;base64,${(await sharp(bytes).resize(256,256).jpeg().toBuffer()).toString('base64')}`;
 await page.route('**/api/account/photo',async r=>{
  expect(r.request().method()).toBe('PUT');
  const metadata=await sharp(r.request().postDataBuffer()!).metadata(); expect(metadata.width).toBe(512);
  return r.fulfill({status:fail?503:200,json:fail?{error:'Couldn’t save your photo. Try again.'}:{image:saved}});
 });
 await expect(page.getByRole('button',{name:'Edit profile photo',exact:true})).toBeVisible();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 await page.screenshot({path:'/tmp/dash-profile-edit-settings.png'});
 for(const retry of [false,true]){
  fail=!retry;
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Edit profile photo',exact:true}).click();
  await (await chooser).setFiles({name:'photo.png',mimeType:'image/png',buffer:bytes});
  if(!retry){await expect(page.locator('.wd-profile-photo-error')).toContainText('Couldn’t save');await expect(page.locator('.wd-profile-photo-editor img')).toHaveCount(0);}
 }
 await expect(page.locator('.wd-profile-photo-editor img')).toHaveAttribute('src',saved);
 await expect(page.locator('.wd-profile-photo-error')).toHaveCount(0);
 await page.getByRole('button',{name:'Account',exact:true}).click();
 await expect(page.locator('.wd-account-group .wd-profile-photo-editor img')).toHaveAttribute('src',saved);
});
