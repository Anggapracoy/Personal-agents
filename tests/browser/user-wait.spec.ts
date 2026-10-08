import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({entryPoints:['tests/browser/fixtures/user-wait.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
for (const browser of [false, true]) test(`user wait preserves ${browser ? 'browser takeover' : 'direct continuation'}`, async ({page}) => {
  await page.goto(`/?uiPreview=1${browser ? '&browser=1' : ''}`);
  await page.setContent('<div id="root"></div>');
  for (const file of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({content:readFileSync(file,'utf8')});
  await page.addScriptTag({content:bundle});
  const button = page.getByRole('button', { name: browser ? 'Open the browser' : 'Continue when done', exact:true });
  await expect(button).toBeVisible();
  if (!browser) await page.screenshot({path:'/tmp/dash-continue-when-done.png'});
  await button.click();
  await expect(page.locator('body')).toHaveAttribute(browser ? 'data-opened' : 'data-continued','true');
  await expect(page.locator('body')).not.toHaveAttribute(browser ? 'data-continued' : 'data-opened','true');
});
