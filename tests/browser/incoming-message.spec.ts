import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/incoming-message.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
for (const native of [false, true]) test(`reply expands its surface without remounting (${native ? 'native' : 'web'})`,async({page})=>{
 await page.route('**/?uiPreview=1',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
 await page.goto('/?uiPreview=1');
 for(const file of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({content:readFileSync(file,'utf8')});
 if (native) await page.evaluate(() => Object.assign(window, {__decisionFeedNativeMessageMenus:true}));
 await page.addScriptTag({content:bundle});
 await expect(page.locator('.wd-typing')).toBeVisible();
 await page.evaluate(()=>{
  (window as any).arrivalAnimations=[];
  const original=Element.prototype.animate;
  Element.prototype.animate=function(frames,options){
   const animation=original.call(this,frames,options);
   if(Array.isArray(frames) && frames.some(frame=>frame.clipPath)) {animation.pause(); animation.play=()=>{};}
   if(this.classList.contains('wd-incoming-surface')) {animation.pause(); animation.play=()=>{}; (window as any).arrivalAnimations.push({frames,options,animation});}
   return animation;
  };
  (window as any).incomingTest.receive();
 });
 await expect(page.locator('.wd-incoming-surface')).toBeVisible();
 await expect(page.locator('.wd-typing')).toHaveCount(0);
 const frames=await page.evaluate(()=>(window as any).arrivalAnimations.map(({frames,options}:any)=>({frames,options})));
 expect(frames).toHaveLength(1);
 expect(frames[0].options.duration).toBe(140);
 expect(parseFloat(frames[0].frames[0].width)).toBeLessThan(parseFloat(frames[0].frames[1].width));
 await expect(page.locator('[data-message-id="reply"] .wd-message-markdown')).toHaveCSS('transform','none');
 await expect(page.locator('[data-message-id="reply"] > .wd-agent:not(.wd-incoming-surface)')).not.toHaveCSS('clip-path','none');
 await page.evaluate(()=>(window as any).arrivalAnimations[0].animation.currentTime=70);
 await page.screenshot({path:'/tmp/dash-incoming-midpoint.png'});
 await page.waitForTimeout(60);
 await page.evaluate(()=>(window as any).arrivalAnimations[0].animation.currentTime=70);
 const animatedBottom=(await page.locator('.wd-incoming-surface').boundingBox())!;
 const realBottom=(await page.locator('[data-message-id="reply"] > .wd-agent:not(.wd-incoming-surface)').boundingBox())!;
 expect(Math.abs(animatedBottom.y+animatedBottom.height-realBottom.y-realBottom.height)).toBeLessThan(.5);
 await page.evaluate(()=>(window as any).arrivalAnimations[0].animation.currentTime=140);
 const animatedWidth=(await page.locator('.wd-incoming-surface').boundingBox())!.width;
 const finalWidth=(await page.locator('[data-message-id="reply"] > .wd-agent:not(.wd-incoming-surface)').boundingBox())!.width;
 expect(Math.abs(animatedWidth-finalWidth)).toBeLessThan(.5);
 await page.evaluate(()=>(window as any).arrivalAnimations[0].animation.finish());
 await expect(page.locator('.wd-incoming-surface')).toHaveCount(0);
 const handedOffWidth=(await page.locator('[data-message-id="reply"] > .wd-agent').boundingBox())!.width;
 expect(Math.abs(animatedWidth-handedOffWidth)).toBeLessThan(.5);
 await expect(page.locator('[data-message-id="reply"]')).toBeVisible();
 await page.screenshot({path:'/tmp/dash-incoming-final.png'});
});
