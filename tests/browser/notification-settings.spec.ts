import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = createRequire(require.resolve('tsx'))('esbuild').buildSync({ stdin: { contents: `import {createRoot} from 'react-dom/client'; import {NotificationSettings} from './app/notification-settings'; createRoot(document.getElementById('root')).render(<NotificationSettings/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
test('notification settings reports live permission and requests changes only on tap', async ({ page }) => {
  await page.route('**/notification-fixture', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('/notification-fixture');
  await page.evaluate(() => {
    Object.assign(window, { __decisionFeedNativeNotificationSettings: true, calls: [], webkit: { messageHandlers: { decisionFeedNative: { postMessage: (message: unknown) => (window as any).calls.push(message) } } } });
  });
  await page.addScriptTag({ content: bundle });
  const receive = (status: string) => page.evaluate(status => window.dispatchEvent(new CustomEvent('decisionFeed:notificationSettings', { detail: { status } })), status);
  await expect.poll(() => page.evaluate(() => (window as any).calls.map((m: any) => m.action))).toEqual(['notificationSettingsStatus']);
  await receive('notDetermined');
  await page.getByRole('button', { name: 'Notifications, Enable', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).calls.at(-1).action)).toBe('manageNotifications');
  await receive('on');
  await expect(page.getByRole('button', { name: 'Notifications, On', exact: true })).toBeEnabled();
  await receive('off');
  await expect(page.getByRole('button', { name: 'Notifications, Off', exact: true })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(() => (window as any).calls.at(-1).action)).toBe('notificationSettingsStatus');
  await receive('quiet');
  await expect(page.getByRole('button', { name: 'Notifications, Quietly', exact: true })).toBeVisible();
});
