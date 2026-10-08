import { test, expect } from '@playwright/test';

test('search moves the feed smoothly in both directions without resizing its rows', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  const home = page.locator('.wd-home').first();
  const row = home.locator('.wd-row').first();
  const search = home.locator('.wd-home-search-reveal');
  const baseline = (await row.boundingBox())!;
  await home.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect(home.getByRole('searchbox')).toBeFocused();
  const samples = await home.evaluate(async el => {
    const reveal = el.querySelector('.wd-home-search-reveal')!;
    const row = el.querySelector('.wd-row')!;
    const samples: { height: number; rowHeight: number; rowWidth: number; top: number }[] = [];
    const until = performance.now() + 430;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      const box = row.getBoundingClientRect();
      samples.push({ height: reveal.getBoundingClientRect().height, rowHeight: box.height, rowWidth: box.width, top: box.top });
    }
    return samples;
  });
  const expanded = (await search.boundingBox())!.height;
  expect(samples.some(sample => sample.height > 0 && sample.height < expanded - 1)).toBe(true);
  for (const sample of samples) {
    expect(sample.rowHeight).toBeCloseTo(baseline.height, 1);
    expect(sample.rowWidth).toBeCloseTo(baseline.width, 1);
  }
  expect(samples.at(-1)!.top - baseline.y).toBeCloseTo(expanded, 0);
  await page.screenshot({ path: '/tmp/dash-search-expanded.png' });
  await home.getByRole('button', { name: 'Close search', exact: true }).click();
  await page.waitForTimeout(80);
  const closing = (await search.boundingBox())!.height;
  expect(closing).toBeGreaterThan(0); expect(closing).toBeLessThan(expanded);
  // Reverse before collapse finishes, then close again.
  await home.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect.poll(async () => (await search.boundingBox())!.height).toBe(expanded);
  await home.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect.poll(async () => (await search.boundingBox())!.height).toBe(0);
  expect((await row.boundingBox())!.y).toBeCloseTo(baseline.y, 1);
  await expect(home.locator('input.wd-home-search')).toBeDisabled();
});

test('search respects reduced motion and still filters conversations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?uiPreview=1');
  const home = page.locator('.wd-home').first();
  await home.getByRole('button', { name: 'Search conversations', exact: true }).click();
  const field = home.getByRole('searchbox');
  await expect(field).toBeFocused();
  await field.fill('no matching conversation 93824');
  await expect(home.locator('.wd-row')).toHaveCount(0);
  await home.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(home.locator('.wd-row').first()).toBeVisible();
  expect((await home.locator('.wd-home-search-reveal').boundingBox())!.height).toBe(0);
});
