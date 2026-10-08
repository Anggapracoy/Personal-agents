import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/financial-approval-options.tsx'], bundle: true, write: false, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;

test('four financial actions use the same inline approval card with accurate headings', async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 1000 });
  await page.route('**/approval-options', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('/approval-options');
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('.wd-checkout')).toHaveCount(4);
  await expect(page.locator('.wd-checkout-heading strong')).toHaveText([
    'Checkout · Dash wants to place an order at naturamarket.ca',
    'Bill payment · Dash wants to pay a bill at torontohydro.com',
    'Transfer · Dash wants to send money at bank.example',
    'Payment · Dash wants to pay at service.example',
  ]);
  await expect(page.locator('.wd-checkout-actions')).toHaveCount(4);
  await page.screenshot({ path: '/tmp/dash-financial-approval-options.png', fullPage: true });
});
