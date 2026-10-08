import { test, expect } from '@playwright/test';

test('feed starts with conversations and gives visible avatars reduced-motion-aware expressions', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await expect(page.locator('.wd-feed-greeting')).toHaveCount(0);
  const avatar = page.locator('.is-feed-idle').first();
  await expect(avatar).toHaveAttribute('data-idle-visible', 'true');
  const eye = avatar.locator('.wd-character-eye').first();
  await expect(eye).toHaveCSS('animation-name', 'wd-character-blink');
  await page.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await expect(page.getByRole('button', { name: 'You', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(eye).toHaveCSS('animation-name', 'none');
});
test('landing phone starts with the conversation feed, without the retired greeting', async ({ page }) => {
  await page.goto('/');
  const phone = page.getByRole('img', { name: /Dash iPhone app preview with a waiting update/ });
  await expect(phone).toContainText('Your subscription renews tomorrow');
  await expect(phone).toContainText('Booking L’Artusi');
  await expect(phone).not.toContainText('Morning, Alex');
  await phone.screenshot({ path: 'artifacts/feed-greeting/landing-phone.png' });
});
