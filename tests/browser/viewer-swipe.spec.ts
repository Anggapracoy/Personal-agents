import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/browser-viewer.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
test.use({ hasTouch: true, isMobile: true });

// Real touch input exercises implicit pointer capture, unlike page.mouse.
async function swipe(page: Page, x: number, y: number, dx: number, dy: number) {
  const input = await page.context().newCDPSession(page);
  await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 12; step++) {
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 12, y: y + dy * step / 12 }] });
  }
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await input.detach();
}

test('photo dismisses from a touch swipe starting on the image', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-call-completed-run');
  const thumb = page.getByRole('button', { name: 'Open photo 1: Portrait photo you sent', exact: true });
  await thumb.click();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer', exact: true });
  await expect(viewer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const image = (await page.locator('.wd-photo-full img').boundingBox())!;
  const x = image.x + image.width / 2, y = image.y + image.height / 2;
  await swipe(page, x, y, 0, 30);
  await expect(viewer).toBeVisible();
  await swipe(page, x, y, 100, 15);
  await expect(viewer).toBeVisible();
  await swipe(page, x, y, 0, 180);
  await expect(viewer).not.toBeVisible();
  await expect(thumb).toBeFocused();
});

for (const live of [false, true]) test(`browser dismisses from the unzoomed ${live ? 'stream' : 'frame'} with real touch input`, async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.route('**/api/runs/viewer-test/artifacts/*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#ddd"/></svg>' }));
  await page.route('**/api/runs/viewer-test/browser?control=0', route => route.fulfill({ contentType: 'text/html', body: '<p>Live stream</p>' }));
  await page.evaluate(live => { (window as any).liveBrowserFixture = live; }, live);
  await page.setContent('<div id="root"></div>');
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css', 'app/browser-viewer.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect.poll(async () => Math.round((await page.locator('.cloud-browser-panel').boundingBox())!.y)).toBe(0);
  await swipe(page, 190, 320, 0, 16);
  await expect(page.locator('body')).not.toHaveAttribute('data-closed', 'true');
  await swipe(page, 190, 320, 110, 20);
  await expect(page.locator('body')).not.toHaveAttribute('data-closed', 'true');
  const pinch = await page.context().newCDPSession(page);
  await pinch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 320, id: 0 }, { x: 230, y: 320, id: 1 }] });
  for (let step = 1; step <= 6; step++) await pinch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150 - step * 8, y: 320, id: 0 }, { x: 230 + step * 8, y: 320, id: 1 }] });
  await pinch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pinch.detach();
  await expect(page.getByRole('button', { name: 'Reset zoom', exact: true })).toBeVisible();
  await swipe(page, 190, 320, 0, 230);
  await expect(page.locator('body')).not.toHaveAttribute('data-closed', 'true');
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await swipe(page, 190, 320, 0, 230);
  await expect(page.locator('body')).toHaveAttribute('data-closed', 'true');
});
