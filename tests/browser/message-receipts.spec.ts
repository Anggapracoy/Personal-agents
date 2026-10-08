import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/message-receipts.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;

test('question and answer panels do not hide outgoing delivery receipts', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as any).receiptTest.setState('sending'));
  await expect(page.locator('[data-message-id="reply"] .wd-message-receipt')).toHaveText('Sending…');
  await page.screenshot({ path: '/tmp/dash-question-sending.png' });
  await page.evaluate(() => (window as any).receiptTest.setState('sent'));
  await expect(page.locator('[data-message-id="reply"] .wd-message-receipt')).toHaveText('Sent');
  await expect(page.locator('[data-inline-id="approval:question"]')).toBeVisible();
  await page.screenshot({ path: '/tmp/dash-question-sent.png' });
  await page.evaluate(() => (window as any).receiptTest.setState('answered'));
  await expect(page.locator('.wd-message-receipt')).toHaveCount(0);
  await page.evaluate(() => (window as any).receiptTest.setState('failed'));
  await expect(page.locator('.wd-message-receipt')).toHaveText('Failed');
});
