import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({entryPoints:['tests/browser/fixtures/first-suggestion-hint.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'}).outputFiles[0].text;
test('first-suggestion guidance waits for suggestions and does not return after leaving Home', async ({page}) => {
 let seen=false, claims=0;
 await page.route('**/?hintFixture=1', route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.route('**/api/onboarding/suggestion-hint', route=>{if(route.request().method()==='POST'){seen=true;claims++;} return route.fulfill({json:{seen,eligible:true,claimed:route.request().method()==='POST'}});});
 await page.goto('/?hintFixture=1'); await page.addScriptTag({content:bundle});
 const hint=page.getByText('Tap a suggestion to get started.');
 await expect(hint).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle suggestions'}).click(); await expect(hint).toBeVisible();
 await expect.poll(()=>claims).toBe(1);
 await page.getByRole('button',{name:'Toggle suggestions'}).click(); await expect(hint).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle suggestions'}).click(); await expect(hint).toHaveCount(0);
 expect(claims).toBe(1);
});
