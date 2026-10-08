import { test, expect } from '@playwright/test';

for (const title of ['Check the delivery', 'Dinner with Alex', 'Dinner at L’Artusi', 'Reset your Example password', 'Check my flight', 'Dinner booked']) {
  test(`inline modules remain readable in dark mode: ${title}`, async ({ page }) => {
    await page.goto('/?uiPreview=1');
    await page.getByText(title, { exact: true }).click();
    const card = page.locator('.wd-front-layer :is(.wd-card, .wd-receipt)').first();
    await expect(card).toBeVisible();
    await page.evaluate(() => document.documentElement.dataset.appearance = 'dark');
    await expect(page.getByRole('button', { name: 'Stop waiting', exact: true })).toHaveCount(0);
    const failures = await card.evaluate(root => {
      const luminance = (color: string) => {
        const scale = color.startsWith('color(srgb') ? 1 : 255;
        const channels = color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(c => { c /= scale; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      return Array.from(root.querySelectorAll<HTMLElement>('*')).filter(el => el.getClientRects().length && Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) && !el.closest(':disabled')).flatMap(el => {
        let ancestor: HTMLElement | null = el;
        while (ancestor && getComputedStyle(ancestor).backgroundColor === 'rgba(0, 0, 0, 0)') ancestor = ancestor.parentElement;
        const style = getComputedStyle(el);
        const fg = luminance(style.color), bg = luminance(ancestor ? getComputedStyle(ancestor).backgroundColor : 'rgb(0,0,0)');
        const ratio = (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
        return ratio < 4.5 ? [{ text: el.textContent, color: style.color, ratio }] : [];
      });
    });
    expect(failures).toEqual([]);
    await page.screenshot({ path: `/tmp/dash-inline-dark-${title.replace(/[^a-z]/gi,'-')}.png` });
  });
}
