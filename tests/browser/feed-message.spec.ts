import { test, expect } from '@playwright/test';

test('first sent message appears in the feed before conversation polling catches up', async ({ page }) => {
  await page.route('**/api/runs', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    const now = new Date().toISOString();
    await route.fulfill({ json: { ...body, id: 'feed-preview-run', userId: 'preview', status: 'running', response: '', result: null, error: null, createdAt: now, updatedAt: now, completedAt: null, actions: [], artifacts: [] } });
  });
  await page.route('**/api/runs/feed-preview-run/**', route => route.fulfill({ json: {} }));
  await page.goto('/?uiPreview=1');
  await page.getByRole('textbox', { name: 'Message Dash…', exact: true }).fill('Find a quiet cafe for tomorrow');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.wd-front-layer .wd-bubble.is-me').last()).toContainText('Find a quiet cafe for tomorrow');
  await page.locator('.wd-front-layer').getByRole('button', { name: /^Back/ }).click();
  const row = page.locator('.wd-home .wd-row').filter({ hasText: 'Find a quiet cafe for tomorrow' }).first();
  await expect(row).toBeVisible();
  // Active work displays its live activity instead of the last-message subtitle.
  await expect(row).toContainText('Thinking');
  await expect(page.locator('.wd-front-layer, .wd-navigation-ghost')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/dash-feed-message.png' });
});
