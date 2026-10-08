import { test, expect } from '@playwright/test';

for (const reducedMotion of [false, true]) {
  test(`first scan task arrives smoothly${reducedMotion ? ' with reduced motion' : ''}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => {
      const original = Element.prototype.animate;
      (window as any).taskArrivals = [];
      Element.prototype.animate = function (frames, options) {
        if (this.classList.contains('wd-proactive-swipe')) (window as any).taskArrivals.push({ frames, options });
        return original.call(this, frames, options);
      };
    });
    await page.goto('/?uiPreview=1&scanPreview=arriving');
    await expect(page.getByText('I’m checking what needs attention.')).toBeVisible();
    await expect(page.locator('.wd-proactive-swipe')).toHaveCount(1, { timeout: 6000 });
    const arrivals = await page.evaluate(() => (window as any).taskArrivals);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].options.duration).toBe(reducedMotion ? 120 : 360);
    if (reducedMotion) expect(arrivals[0].frames[0]).not.toHaveProperty('transform');
    else expect(parseFloat(arrivals[0].frames[0].transform.match(/[\d.]+/)[0])).toBeGreaterThan(100);
    await expect(page.locator('.wd-proactive-swipe')).toHaveCount(2, { timeout: 5000 });
    expect(await page.evaluate(() => (window as any).taskArrivals.length)).toBe(1);
    await expect(page.locator('.wd-proactive-swipe').first()).toHaveCSS('transform', 'none');
  });
}
