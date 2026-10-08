import { test, expect } from '@playwright/test';

test('header shimmer is clipped to subtitle text and respects reduced motion', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByText('Booking L’Artusi', { exact: true }).click();
  const activity = page.locator('.wd-front-layer .wd-chat-activity');
  await expect(activity).toBeVisible();
  await expect(page.locator('.wd-front-layer [data-activity-icon]')).toHaveAttribute('data-activity-icon', 'browser');
  await expect(activity).toHaveCSS('font-size', '13px');
  await expect(activity).toHaveText('Reading reservation options');
  const styles = await activity.evaluate(el => ({ clip: getComputedStyle(el).backgroundClip, animation: getComputedStyle(el).animationName, parentAnimation: getComputedStyle(el.parentElement!).animationName, titleAnimation: getComputedStyle(el.closest("strong")!.querySelector(".wd-chat-name")!).animationName }));
  expect(styles).toEqual({ clip: 'text', animation: 'wd-activity-shimmer', parentAnimation: 'none', titleAnimation: 'none' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/dash-header-shimmer-light.png' });
  await page.evaluate(() => document.documentElement.dataset.appearance = 'dark');
  await page.screenshot({ path: '/tmp/dash-header-shimmer-dark.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(activity).toHaveCSS('animation-name', 'none');
  await expect.poll(() => activity.evaluate(el => getComputedStyle(el).webkitTextFillColor)).not.toBe('rgba(0, 0, 0, 0)');
});
