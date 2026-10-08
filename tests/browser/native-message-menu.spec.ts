import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/native-message-menu.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
test.beforeEach(async ({ page }) => {
  await page.route('**/native-message-fixture', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' }));
  await page.goto('/native-message-fixture');
  for (const path of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(path, 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1)?.payload.items.length)).toBe(2);
});
test('native holds never mount a web menu; explicit opening uses the correct native target', async ({ page }) => {
  const bubble = page.locator('[data-native-message-menu]').first();
  const box = (await bubble.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
  await page.waitForTimeout(600); await page.mouse.up();
  await expect(page.locator('.wd-reaction-overlay')).toHaveCount(0);
  await bubble.dispatchEvent('contextmenu');
  await expect(page.locator('.wd-reaction-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Message actions' }).nth(1).focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => {
    const messages = (window as any).menuFeedback;
    const key = messages.findLast((m: any) => m.action === 'showMessageMenu').payload.key;
    return messages.findLast((m: any) => m.action === 'messageMenuItems').payload.items.find((m: any) => m.key === key).text;
  })).toBe('Second message');
});
test('native reply, reaction, removal and failure retain their message targets', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as any, items = w.menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items;
    await w.__decisionFeedMessageAction(items[1].key, 'reply', null);
    await w.__decisionFeedMessageAction(items[0].key, 'react', '❤️');
  });
  expect(await page.evaluate(() => (window as any).replied)).toBe('second');
  await expect(page.getByRole('button', { name: 'You reacted ❤️, change reaction' })).toBeVisible();
  await page.evaluate(async () => {
    const w = window as any, key = w.menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0].key;
    await w.__decisionFeedMessageAction(key, 'react', null);
    w.failReaction = true;
    try { await w.__decisionFeedMessageAction(key, 'react', '👍'); } catch (error) { w.reactionError = String(error); }
  });
  await expect(page.locator('.wd-tapback')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).reactionError)).toContain('offline');
});
test('native geometry excludes links, tracks scrolling, and clears unmounted targets', async ({ page }) => {
  const initial = await page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0]);
  expect(initial.excluded.some((r: any) => r.width > 0 && r.height > 0)).toBe(true);
  await page.locator('main').evaluate(node => { node.style.transform = 'translateY(30px)'; });
  await expect.poll(() => page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0].y)).toBe(initial.y + 30);
  await page.evaluate(() => (window as any).hideMessages());
  await expect.poll(() => page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items)).toEqual([]);
  expect(await page.evaluate(() => typeof (window as any).__decisionFeedMessageAction)).toBe('undefined');
});

test('emoji entry can complete after the keyboard moves its message offscreen', async ({ page }) => {
  const key = await page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0].key);
  await page.locator('main').evaluate(node => { node.style.transform = 'translateY(-1200px)'; });
  await expect.poll(() => page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items)).toEqual([]);
  await page.evaluate(async key => { await (window as any).__decisionFeedMessageAction(key, 'react', '🎉'); }, key);
  expect(await page.evaluate(() => (window as any).reacted)).toBe('🎉');
});


test('reaction appears before a slow save, replacement stays visible, and failure rolls back', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any;
    w.delayReaction = true;
    w.reactionKey = w.menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0].key;
    w.firstSave = w.__decisionFeedMessageAction(w.reactionKey, 'react', '❤️');
  });
  await expect(page.getByRole('button', { name: 'You reacted ❤️, change reaction' })).toBeVisible();
  await page.getByRole('button', { name: 'You reacted ❤️, change reaction' }).click();
  const pendingMenu = await page.evaluate(() => {
    const w = window as any;
    const messages = w.menuFeedback;
    const opened = messages.findLast((m: any) => m.action === 'showMessageMenu').payload.key;
    return messages.findLast((m: any) => m.action === 'messageMenuItems').payload.items.find((item: any) => item.key === opened);
  });
  expect(pendingMenu.canReact).toBe(true);
  expect(pendingMenu.selected).toBe('❤️');
  await page.evaluate(() => {
    const w = window as any;
    w.secondSave = w.__decisionFeedMessageAction(w.reactionKey, 'react', '👍').catch(() => {});
  });
  await expect(page.getByRole('button', { name: 'You reacted 👍, change reaction' })).toBeVisible();
  await page.evaluate(async () => { const w = window as any; w.finishReaction(); await w.firstSave; });
  await expect(page.getByRole('button', { name: 'You reacted 👍, change reaction' })).toBeVisible();
  await page.evaluate(async () => { const w = window as any; w.rejectReaction(); await w.secondSave; });
  await expect(page.getByRole('button', { name: 'You reacted ❤️, change reaction' })).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    w.removal = w.__decisionFeedMessageAction(w.reactionKey, 'react', null);
  });
  await expect(page.locator('.wd-tapback')).toHaveCount(0);
  await page.evaluate(async () => { const w = window as any; w.finishReaction(); await w.removal; });
  await expect(page.locator('.wd-tapback')).toHaveCount(0);
});


test('held-message preview includes the full overhanging reaction without enlarging its hit target', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as any;
    const key = w.menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0].key;
    await w.__decisionFeedMessageAction(key, 'react', '❤️');
  });
  const badge = (await page.locator('.wd-tapback').boundingBox())!;
  const message = (await page.locator('[data-native-message-menu]').first().boundingBox())!;
  expect(badge.y).toBeLessThan(message.y);
  await expect.poll(() => page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0].previewRects.length)).toBe(2);
  const target = await page.evaluate(() => (window as any).menuFeedback.filter((m: any) => m.action === 'messageMenuItems').at(-1).payload.items[0]);
  expect(target.y).toBe(message.y);
  expect(target.previewRects[1]).toEqual(badge);
});
