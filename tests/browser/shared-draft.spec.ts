import { test, expect } from '@playwright/test';

test('native shares return to Home and stage a draft without creating a conversation', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(share-intake|runs)(?:\?|$)/.test(request.url())) writes.push(request.url()); });
  await page.goto('/?uiPreview=1');
  const home = page.locator('.wd-home-layer .wd-composer');
  await home.locator('textarea').fill('Please review');
  await page.getByText('Dinner at L’Artusi', { exact: true }).first().click();
  await expect(page.locator('.wd-front-layer')).toBeVisible();
  const share = { requestId: 'share-test-1', text: 'Shared receipt', files: [{ name: 'Receipt.txt', mimeType: 'text/plain', size: 13, dataBase64: Buffer.from('receipt bytes').toString('base64') }] };
  expect(await page.evaluate(detail => window.dispatchEvent(new CustomEvent('decisionFeed:sharedIntake', { detail, cancelable: true })), share)).toBe(true);
  await expect(page.locator('.wd-front-layer')).toHaveCount(0);
  await expect(home.locator('textarea')).toHaveValue('Please review\n\nShared receipt');
  await home.getByRole('button', { name: 'Add attachment' }).click();
  await expect(home.getByRole('group', { name: 'Attached files' })).toContainText('Receipt.txt');
  await page.keyboard.press('Escape');
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('decisionFeed:sharedIntake', { detail, cancelable: true })), share);
  await expect(home.locator('.wd-composer-plus b')).toHaveText('1');
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('decisionFeed:sharedIntake', { detail, cancelable: true })), { ...share, requestId: 'share-test-2', text: '', files: [{ ...share.files[0], name: 'Second.txt' }] });
  await expect(home.locator('.wd-composer-plus b')).toHaveText('2');
  await home.getByRole('button', { name: 'Add attachment' }).click();
  await expect(home.getByRole('group', { name: 'Attached files' })).toContainText('Second.txt');
  await page.screenshot({ path: '/tmp/dash-shared-draft-home.png' });
  expect(await page.evaluate(detail => window.dispatchEvent(new CustomEvent('decisionFeed:sharedIntake', { detail, cancelable: true })), { ...share, requestId: 'share-too-many', files: Array(5).fill(share.files[0]) })).toBe(false);
  await expect(home.locator('.wd-composer-plus b')).toHaveText('2');
  await expect(home.getByRole('alert')).toContainText('6 files, 3 MB total');
  expect(writes).toEqual([]);
});
