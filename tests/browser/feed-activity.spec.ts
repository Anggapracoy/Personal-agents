import { test, expect } from '@playwright/test';

test('feed shows live tool shimmer while waits remain ordinary and reduced motion stays readable', async ({ page }) => {
 await page.goto('/?uiPreview=1');
 const live = page.locator('.wd-row').filter({ hasText: 'Booking L’Artusi' });
 await expect(live.locator('.wd-chat-activity')).toHaveText('Reading reservation options');
 await expect(live.locator('.wd-chat-activity')).toHaveCSS('animation-name', 'wd-activity-shimmer');
 await expect(live.locator('[data-activity-icon]')).toHaveAttribute('data-activity-icon', 'browser');
 const preview = page.locator('.wd-row').filter({ hasText: 'Check the delivery' }).locator('.wd-chat-activity');
 expect(await live.locator('.wd-chat-activity').evaluate(el => getComputedStyle(el).fontSize)).toBe(await preview.evaluate(el => getComputedStyle(el).fontSize));
 await expect(page.locator('.wd-row').filter({ hasText: 'Dinner at L’Artusi' }).locator('.wd-chat-activity')).toHaveText('On the phone');
 await expect(preview).toHaveCSS('animation-name', 'none');
 await live.scrollIntoViewIfNeeded();
 await page.screenshot({ path: '/tmp/dash-feed-live-activity.png' });
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await expect(live.locator('.wd-chat-activity')).toHaveCSS('animation-name', 'none');
 await expect.poll(() => live.locator('.wd-chat-activity').evaluate(el => getComputedStyle(el).webkitTextFillColor)).not.toBe('rgba(0, 0, 0, 0)');
 await page.evaluate(() => document.documentElement.dataset.appearance = 'dark');
 await page.screenshot({ path: '/tmp/dash-feed-live-activity-dark.png' });
});
