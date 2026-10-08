import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/waiting-feed.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
test.use({ timezoneId: 'America/Toronto' });
test('waiting feed shows a readable deadline instead of stale message text', async ({ page }) => {
 await page.route('**/waiting-feed-fixture', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
 await page.goto('/waiting-feed-fixture');
 for (const path of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(path, 'utf8') });
 await page.addScriptTag({ content: bundle });
 await expect(page.getByText('Waiting until Sep 28, 10:08 PM')).toBeVisible();
 await expect(page.getByText('Waiting for reply · Checks Sep 28, 10:08 PM')).toBeVisible();
 await expect(page.getByText('Stale message')).toHaveCount(0);
 for (const label of await page.locator('.is-waiting .wd-chat-activity').all()) {
   expect(await label.evaluate(el => ({ fits: el.scrollHeight <= el.clientHeight + 1, animation: getComputedStyle(el).animationName }))).toEqual({ fits: true, animation: 'none' });
 }
 await page.screenshot({ path: '/tmp/dash-waiting-feed.png' });
});
