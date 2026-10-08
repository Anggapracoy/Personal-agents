import { test, expect } from '@playwright/test';

test('chat blocks horizontal scrolling while vertical scrolling and back navigation still work', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'IconScout renews for $149 You have not used it in 6 weeks', exact: true }).click();
  const chat = page.locator('.wd-front-layer .wd-task');
  await expect(chat).toBeVisible();
  await expect.poll(() => page.locator('.wd-front-layer').evaluate(el => getComputedStyle(el).transform)).toBe('none');
  // An oversized child must not make the whole chat pannable; inner tables/code
  // retain their own scroll containers instead.
  await chat.evaluate(el => { const content = document.createElement('div'); content.style.cssText = 'width:900px;height:1800px'; el.append(content); });
  await chat.hover({ position: { x: 150, y: 450 } });
  await page.mouse.wheel(240, 0);
  await page.waitForTimeout(150);
  expect(await chat.evaluate(el => el.scrollLeft)).toBe(0);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.evaluate(() => {
    for (const [phase, progress] of [['began', 0], ['changed', .2], ['cancelled', .2]] as const)
      window.dispatchEvent(new CustomEvent('decisionFeed:nativeBackSwipe', { detail: { phase, progress, commit: false } }));
  });
  await expect.poll(() => page.locator('.wd-front-layer').evaluate(el => getComputedStyle(el).transform)).toBe('none');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('decisionFeed:nativeBackSwipe', { detail: { phase: 'ended', progress: .5, commit: true } })));
  await expect(page.locator('.wd-front-layer')).toHaveCount(0);
});
