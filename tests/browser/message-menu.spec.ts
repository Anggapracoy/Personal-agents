import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/message-menu.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/message-menu-fixture', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' }));
  await page.goto('/message-menu-fixture');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
});
test('hold opens once, synchronizes blur and dismisses on the first outside press', async ({ page }) => {
  const bubble = page.locator('main > .wd-reactable');
  const box = (await bubble.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.up();
  await bubble.dispatchEvent('contextmenu');
  expect(await page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'hapticSelection').length)).toBe(1);
  await expect(page.locator('.wd-reaction-dismiss')).toHaveCSS('backdrop-filter', 'blur(3px)');
  await expect(page.locator('.wd-reaction-overlay')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/dash-message-menu.png' });
  // The original selected bubble is also outside the action controls.
  await page.mouse.click(box.x + 30, box.y + 20);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await bubble.click({ button: 'right' });
  await page.mouse.click(8, 80);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('Copy stays anchored, confirms success, then dismisses', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedText = text; } } }));
  await page.locator('main > .wd-reactable').click({ button: 'right' });
  const copy = page.getByRole('button', { name: 'Copy', exact: true });
  await expect(page.locator('.wd-reaction-dismiss')).toHaveCSS('backdrop-filter', 'blur(3px)');
  const box = (await copy.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await expect(copy).toHaveCSS('transform', 'none');
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).copiedText)).toBe('Tuesday works for me.');
  expect(await page.evaluate(() => (window as any).menuFeedback.some((m: any) => m.action === 'hapticSuccess'))).toBe(true);
  await expect(page.locator('.wd-copy-icon > :last-child')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/dash-message-copied.png' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('copy failure is retryable and Escape dismisses with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await page.locator('main > .wd-reactable').click({ button: 'right' });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Try again');
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('moving a hold cancels opening', async ({ page }) => {
  const box = (await page.locator('main > .wd-reactable').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 45);
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a touch outside closes the expanded picker on the first tap', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('main > .wd-reactable').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 50, clientY: 235 });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('main > .wd-reactable').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true });
  await page.getByRole('button', { name: 'More emoji' }).tap();
  await expect(page.getByRole('textbox', { name: 'Any emoji' })).toBeVisible();
  await page.screenshot({ path: '/tmp/dash-message-menu-dark.png' });
  await page.touchscreen.tap(8, 80);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
