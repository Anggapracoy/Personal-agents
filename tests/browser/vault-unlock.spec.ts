import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/vault-unlock.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
const item = { id: 'card', kind: 'payment_card', label: 'Personal card', siteHost: 'naturamarket.ca', cardBrand: 'Mastercard', cardLast4: '5908', usernameHint: null, updatedAt: '' };

for (const modern of [true, false]) test(`saved-card selection preserves authentication ordering (${modern ? 'new' : 'existing'} wrapper)`, async ({ page }) => {
  let prepared = 0;
  await page.route('**/api/vault', route => route.fulfill({ json: { items: [item] } }));
  await page.route('**/api/runs/run/vault', async route => { prepared++; await route.fulfill({ json: { recipientPublicKey: 'test-key', kind: 'payment_card', needSecurityCode: true } }); });
  await page.goto('/?uiPreview=1');
  await page.setContent('<div id="root"></div>');
  await page.evaluate(modern => {
    (window as any).__decisionFeedNativeVaultSelection = modern;
    (window as any).vaultCalls = [];
    (window as any).webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => { if (message.action === "vaultRelease") (window as any).vaultCalls.push(message); } } } };
  }, modern);
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await page.locator('.wd-vault-picker').screenshot({ path: '/tmp/dash-card-picker.png' });
  await page.getByRole('button', { name: /Personal card/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).vaultCalls.length)).toBe(1);
  const call = await page.evaluate(() => (window as any).vaultCalls[0]);
  expect(call.action).toBe('vaultRelease');
  expect(prepared).toBe(modern ? 0 : 1);
  expect(call.payload.prepareSelection).toBe(modern ? true : undefined);
  expect(call.payload.recipientPublicKey).toBe(modern ? undefined : 'test-key');
  if (modern) {
    await page.evaluate(requestId => window.dispatchEvent(new CustomEvent('decisionFeed:vaultResult', { detail: { requestId, ok: true, phase: 'authenticated' } })), call.payload.requestId);
    await expect(page.locator('.wd-receipt')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Personal card/ })).toBeDisabled();
    await expect(page.getByText('Task resumed')).toHaveCount(0);
    await page.screenshot({ path: '/tmp/dash-vault-immediate-summary.png' });
    // A failed handoff cannot leave the authenticated preview as a false result.
    await page.evaluate(requestId => window.dispatchEvent(new CustomEvent('decisionFeed:vaultResult', { detail: { requestId, ok: false, error: 'The secure browser restarted. Choose your saved item again.' } })), call.payload.requestId);
    await expect(page.getByRole('button', { name: /Personal card/ })).toBeEnabled();
    await expect(page.locator('.wd-card-error[role="alert"]')).toContainText('browser restarted');
    await expect(page.locator('.wd-receipt')).toHaveCount(0);
    await page.getByRole('button', { name: /Personal card/ }).click();
    await expect.poll(() => page.evaluate(() => (window as any).vaultCalls.length)).toBe(2);
  }
  const requestId = await page.evaluate(() => (window as any).vaultCalls.at(-1).payload.requestId);
  await page.evaluate(requestId => window.dispatchEvent(new CustomEvent('decisionFeed:vaultResult', { detail: { requestId, ok: true, snapshot: { id: 'run', status: 'running' } } })), requestId);
  await expect(page.getByText('Task resumed')).toBeVisible();
  await expect(page.locator('.wd-inline-panel-ghost')).toHaveCount(0);
  await expect(page.locator('.wd-receipt')).toBeVisible();
});

test('inline card form accepts a normal two-digit expiry year', async ({ page }) => {
  await page.route('**/api/vault', route => route.fulfill({ json: { items: [] } }));
  await page.goto('/?uiPreview=1');
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.evaluate(() => {
    (window as any).vaultCalls = [];
    (window as any).webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => (window as any).vaultCalls.push(message) } } };
  });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('textbox', { name: 'Name on card' }).fill('Test User');
  await page.getByRole('textbox', { name: 'Card number' }).fill('4242424242424242');
  await page.getByRole('textbox', { name: 'Expiry' }).fill('13/28');
  await expect(page.getByRole('button', { name: 'Save card and continue' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Expiry' }).fill('12/2028');
  await expect(page.getByRole('button', { name: 'Save card and continue' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Expiry' }).fill('12/28');
  await page.getByRole('textbox', { name: 'Postal code' }).fill('M4B 1B3');
  await expect(page.getByRole('button', { name: 'Save card and continue' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save card and continue' })).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'artifacts/card-form-inline-valid.png' });
  await page.getByRole('button', { name: 'Save card and continue' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).vaultCalls.length)).toBe(1);
  const save = await page.evaluate(() => (window as any).vaultCalls[0]);
  expect(save.action).toBe('vaultSave');
  expect(save.payload.expiryYear).toBe('2028');
});

test('card picker and add form animate in both directions and retain the draft', async ({ page }) => {
  await page.route('**/api/vault', route => route.fulfill({ json: { items: [item] } }));
  await page.goto('/?uiPreview=1');
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Add another card' }).click();
  await expect(page.getByRole('textbox', { name: 'Name on card' })).toBeVisible();
  await expect.poll(() => page.locator('.wd-inline-panel-ghost').count()).toBe(0);
  await page.getByRole('textbox', { name: 'Name on card' }).fill('Test User');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: /Personal card/ })).toBeVisible();
  await expect.poll(() => page.locator('.wd-inline-panel-ghost').count()).toBe(0);
  await page.getByRole('button', { name: 'Add another card' }).click();
  await expect(page.getByRole('textbox', { name: 'Name on card' })).toHaveValue('Test User');
});
