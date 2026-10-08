import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/apple-handoff.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;

test('a completion snapshot followed by a stale pending snapshot cannot flash a Weather error card', async ({ page }) => {
  await page.route('**/?uiPreview=1', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => {
    (window as any).completionRace = true;
    (window as any).__decisionFeedNativeAppleConnections = true;
    (window as any).webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => {
      if (message.action === 'appleConnections') queueMicrotask(() => window.dispatchEvent(new CustomEvent('decisionFeed:appleConnectionsResult', { detail: { requestId: message.payload.requestId, ok: true, connections: [{ id: 'weather', enabled: true, status: 'connected' }] } })));
    } } } };
  });
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => (window as any).executionCalls)).toBe(1);
  // The server can publish completion before the native HTTP response arrives.
  await page.evaluate(() => (window as any).hideApple());
  await expect(page.locator('.wd-apple-action-panel')).toHaveCount(0);
  await page.evaluate(() => (window as any).showApple());
  await expect(page.locator('.wd-apple-action-panel')).toBeAttached();
  await page.waitForTimeout(300);
  await expect(page.getByText('What is the weather?', { exact: true })).toBeVisible();
  await page.locator('.wd-task').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/dash-weather-completion-race.png', animations: 'disabled' });
  await expect(page.locator('.wd-card')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).executionCalls)).toBe(1);
  await page.evaluate(() => (window as any).finishApple());
  await expect(page.locator('.wd-apple-action-panel')).toHaveCount(0);
});

for (const connected of [true, false]) test(`Apple handoff ${connected ? 'stays out of transcript' : 'shows required connection'}`, async ({ page }) => {
  await page.route('**/?uiPreview=1', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('/?uiPreview=1');
  await page.evaluate(connected => {
    (window as any).__decisionFeedNativeAppleConnections = true;
    (window as any).webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => {
      if (message.action === 'appleConnections') setTimeout(() => window.dispatchEvent(new CustomEvent('decisionFeed:appleConnectionsResult', { detail: { requestId: message.payload.requestId, ok: true, connections: [{ id: 'weather', enabled: connected, status: connected ? 'connected' : 'disconnected' }] } })), 250);
    } } } };
  }, connected);
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('.wd-thread')).toBeVisible();
  const height = await page.locator('.wd-thread').evaluate(node => node.getBoundingClientRect().height);
  await page.evaluate(() => (window as any).startApple());
  await expect(page.locator('.wd-apple-action-panel')).toBeAttached();
  // An unresolved native status must not insert even an empty flex row.
  expect(await page.locator('.wd-thread').evaluate(node => node.getBoundingClientRect().height)).toBe(height);
  if (connected) {
    await expect(page.locator('.wd-card')).toHaveCount(0);
    await expect(page.locator('.wd-apple-action-panel')).toHaveCount(0);
    expect(await page.locator('.wd-thread').evaluate(node => node.getBoundingClientRect().height)).toBe(height);
  } else {
    await expect(page.getByRole('button', { name: 'Connect Weather', exact: true })).toBeVisible();
  }
  await expect(page.getByText('What is the weather?', { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/dash-apple-handoff-${connected ? 'connected' : 'disconnected'}.png`, animations: 'disabled' });
});

test('a lost chat save recovers and returns its connected iPhone location without opening the chat', async ({ page }) => {
  await page.route('**/?uiPreview=1', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => {
    (window as any).lostLocationSave = true;
    (window as any).__decisionFeedNativeAppleConnections = true;
    (window as any).deviceCalls = [];
    (window as any).webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => {
      if (message.action !== 'appleConnections') return;
      (window as any).deviceCalls.push(message.payload.kind);
      queueMicrotask(() => window.dispatchEvent(new CustomEvent('decisionFeed:appleConnectionsResult', { detail: {
        requestId: message.payload.requestId, ok: true,
        connections: [{ id: 'location', enabled: true, status: 'connected' }], location: 'test-location-returned',
      } })));
    } } } };
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByTestId('recovered-chat')).toHaveCount(0);
  await page.evaluate(() => (window as any).restoreLostChat());
  await expect(page.getByTestId('recovered-chat')).toHaveText('Streetlight');
  await expect(page.getByTestId('location-result')).toHaveText('test-location-returned');
  expect(await page.evaluate(() => (window as any).deviceCalls)).toEqual(['status', 'execute']);
});
