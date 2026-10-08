import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/attachment-send.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
for (const success of [true, false]) test(`attachment clears before send resolves and ${success ? 'stays cleared on success' : 'restores on failure'}`, async ({ page }) => {
  await page.route('**/attachment-send-fixture', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
  await page.goto('/attachment-send-fixture');
  for (const path of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(path, 'utf8') });
  await page.addScriptTag({ content: bundle });
  const field = page.locator('.wd-composer-field');
  const surface = () => field.evaluate(el => ({ shadow: getComputedStyle(el).boxShadow, color: getComputedStyle(el).backgroundColor }));
  const emptySurface = await surface();
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40; canvas.getContext('2d')!.fillRect(0, 0, 40, 40); return canvas.toDataURL().split(',')[1]; });
  await page.locator('input[data-photos]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.wd-draft-photo-region')).toHaveClass(/is-expanded/);
  expect(await surface()).toEqual(emptySurface);
  await page.getByRole('textbox').fill('Photo attached');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.wd-draft-photo-region')).not.toHaveClass(/is-expanded/);
  await expect.poll(() => page.evaluate(() => (window as any).sentFiles.map((file: File) => file.name))).toEqual(['photo.png']);
  await expect(page.locator('.wd-photo-message img')).toBeVisible();
  await page.screenshot({ path: `/tmp/dash-attachment-sending-${success}.png` });
  await page.evaluate(success => (window as any).finishSend(success), success);
  if (success) await expect(page.locator('.wd-draft-photo-region')).not.toHaveClass(/is-expanded/);
  else {
    await expect(page.locator('.wd-draft-photo-region')).toHaveClass(/is-expanded/);
    await expect(page.getByRole('textbox')).toHaveValue('Photo attached');
  }
});
