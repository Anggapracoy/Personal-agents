import { test, expect } from '@playwright/test';

test('settings disclosures animate opening and closing and can reverse mid-flight', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Connected apps', exact: true }).click();
  const disclosure = page.locator('.wd-source-detail').first();
  const summary = disclosure.locator('summary');
  const closed = (await disclosure.boundingBox())!.height;
  await summary.click();
  await expect.poll(() => disclosure.evaluate(el => el.getAnimations().length)).toBe(0);
  const opened = (await disclosure.boundingBox())!.height;
  expect(opened).toBeGreaterThan(closed + 20);
  // Keyboard activation uses the same animated native summary path.
  await summary.press('Enter');
  const midway = await disclosure.evaluate(el => {
    const animation = el.getAnimations()[0];
    animation.pause(); animation.currentTime = 110;
    return el.getBoundingClientRect().height;
  });
  expect(midway).toBeGreaterThan(closed);
  expect(midway).toBeLessThan(opened);
  await summary.press('Enter');
  await expect.poll(() => disclosure.evaluate(el => el.getAnimations().length)).toBe(0);
  await expect(disclosure).toHaveAttribute('open', '');
  expect((await disclosure.boundingBox())!.height).toBeCloseTo(opened, 0);
  await summary.press('Enter');
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(disclosure.locator('.wd-source-description').getByRole('button')).toBeHidden();
});

test('settings disclosures respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Connected apps', exact: true }).click();
  const disclosure = page.locator('.wd-source-detail').first();
  await disclosure.locator('summary').click();
  expect(await disclosure.evaluate(el => el.getAnimations().length)).toBe(0);
  await expect(disclosure).toHaveAttribute('open', '');
  await page.screenshot({ path: 'artifacts/settings-disclosure/expanded.png' });
  await disclosure.locator('summary').click();
  await expect(disclosure).not.toHaveAttribute('open', '');
});
