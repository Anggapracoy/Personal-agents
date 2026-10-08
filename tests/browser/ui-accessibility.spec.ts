import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`shared text remains readable on app surfaces in ${theme}`, async ({ page }) => {
    await page.goto('/?uiPreview=1&task=preview-messages-polish-run');
    await expect(page.locator('.wd-front-layer .wd-thread')).toBeVisible();
    await page.evaluate(theme => document.documentElement.dataset.appearance = theme, theme);
    const failures = await page.locator('.wd').evaluate(root => {
      const style = getComputedStyle(root);
      const rgb = (color: string) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const lum = (color: string) => rgb(color).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
      const failures: string[] = [];
      for (const fg of ['--ink2', '--ink3', '--red']) for (const bg of ['--bg', '--soft']) {
        if (ratio(style.getPropertyValue(fg), style.getPropertyValue(bg)) < 4.5) failures.push(`${fg} on ${bg}`);
      }
      return failures;
    });
    expect(failures).toEqual([]);
    expect(await page.locator('.wd-bubble.is-me').count()).toBeGreaterThan(0);
  });
}

test('Settings controls and Preferences have full touch targets', async ({ page }) => {
  await page.goto('/?uiPreview=1&view=settings');
  for (const control of await page.locator('.wd-front-layer .wd-round, .wd-front-layer .wd-seg button').all()) {
    const box = await control.boundingBox();
    if (box) { expect(Math.round(box.width * 64) / 64).toBeGreaterThanOrEqual(44); expect(Math.round(box.height * 64) / 64).toBeGreaterThanOrEqual(44); }
  }
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const city = page.getByRole('textbox', { name: 'Home city' });
  await expect(city).toBeVisible();
  expect((await city.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole('button', { name: 'Save', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('admin navigation stays reachable at 320px and adapts to dark appearance', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/admin-erjkfh23lrjghrjk959584?uiPreview=1');
  await expect(page.locator('.admin-tabs')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const tab of await page.locator('.admin-tabs a').all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await page.evaluate(() => document.documentElement.dataset.appearance = 'dark');
  await expect(page.locator('.admin-dashboard')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('.admin-dashboard')).toHaveCSS('color', 'rgb(244, 244, 244)');
});
