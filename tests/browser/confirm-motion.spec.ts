import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({entryPoints:['tests/browser/fixtures/confirm-motion.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
for (const action of ['Keep going','Stop task','Close','Escape']) test(`stop confirmation animates before unmounting via ${action}`,async({page})=>{
 await page.route('**/__confirm-motion-fixture', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })); await page.goto('/__confirm-motion-fixture'); await page.setContent('<div id="root"></div>');
 for(const file of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({content:readFileSync(file,'utf8')});
 await page.addScriptTag({content:bundle}); await page.getByRole('button',{name:'Open stop',exact:true}).click();
 const sheet=page.getByRole('dialog');
 await expect(sheet).toBeVisible();
 await expect.poll(()=>sheet.evaluate(el=>el.getAnimations().every(a=>a.playState==='finished'))).toBe(true);
 const y=(await sheet.boundingBox())!.y;
 if(action==='Escape') await page.keyboard.press('Escape'); else await page.getByRole('button',{name:action,exact:true}).click();
 await expect(sheet).toHaveCount(1);
 await expect.poll(async()=> (await sheet.boundingBox())?.y ?? 852).toBeGreaterThan(y);
 await expect(sheet).toHaveCount(0);
 expect(await page.locator('body').getAttribute('data-stopped')).toBe(action==='Stop task'?'true':null);
});

test('native confirmation failure mounts a dismissible web fallback',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.nativeFailureFixture=true;w.confirm=()=>true;w.coverage=[];w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(m:any)=>{if(m.action==='sheetCoverage')w.coverage.push(m.payload);}}}};});
 await page.route('**/__confirm-motion-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('/__confirm-motion-fixture');
 for(const file of ['app/brand-tokens.css','app/wdyt.css'])await page.addStyleTag({content:readFileSync(file,'utf8')});
 await page.addScriptTag({content:bundle});
 await page.getByRole('button',{name:'Open stop',exact:true}).click();
 await expect(page.getByText('Could not finish. Try again.',{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).coverage.some((p:any)=>p.width>0))).toBe(true);
 await page.getByRole('button',{name:'Stop task',exact:true}).click();
 await expect(page.getByText('Could not finish. Try again.',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.evaluate(()=>(window as any).finishRetry());
 await page.getByRole('button',{name:'Keep going',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).coverage.at(-1)?.ended)).toBe(true);
});
