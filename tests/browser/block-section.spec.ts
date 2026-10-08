import { test, expect } from '@playwright/test';

test('timeline days start closed, show a summary, and open and close by animating height', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByText('Montreal trip', { exact: true }).first().click();
  const accordion = page.locator('.wd-block-accordion').first();
  const rows = accordion.locator('.wd-block-row');
  await expect(rows).toHaveCount(4);
  const wednesday = rows.nth(0);
  const head = wednesday.locator('.wd-block-row-head');
  await head.scrollIntoViewIfNeeded();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(head.locator('small')).toHaveText('Old Montreal, La Grande Roue');
  await expect(wednesday.locator('.wd-block-row-panel')).toHaveJSProperty('inert', true);
  const titleBefore = await head.locator('b').boundingBox();
  const subtitleBefore = await head.locator('small').boundingBox();
  const headerBefore = await head.boundingBox();
  const stableHeader = async () => {
    await expect(head.locator('small')).toBeVisible();
    for (const [locator, before] of [[head, headerBefore], [head.locator('b'), titleBefore], [head.locator('small'), subtitleBefore]] as const) {
      const after = await locator.boundingBox();
      expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
      expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
    }
  };
  const closed = await wednesday.evaluate(el => el.getBoundingClientRect().height);
  const height = () => wednesday.evaluate(el => el.getBoundingClientRect().height);

  await head.click();
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) { samples.push(await height()); await page.waitForTimeout(30); }
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(height).toBeGreaterThan(closed + 40);
  const opened = await height();
  await stableHeader();
  expect(samples.some(value => value > closed + 2 && value < opened - 2), 'height should pass through in-between values').toBe(true);
  await expect(wednesday.locator('.wd-block-row-panel')).toHaveJSProperty('inert', false);
  await expect(wednesday.getByText('Cobblestone streets, shops and a waterfront walk')).toBeVisible();
  await expect(rows.nth(1).locator('.wd-block-row-head')).toHaveAttribute('aria-expanded', 'false');

  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(height).toBeLessThan(closed + 2);
  await expect(wednesday.locator('.wd-block-row-panel')).toHaveJSProperty('inert', true);
  await stableHeader();
});
