import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/inline-timeline.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;

test('inline controls crossfade and resize into receipts', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => sessionStorage.removeItem('Dash:inline:inline-test'));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  const approval = page.locator('[data-inline-id="approval:1"]');
  const before = await approval.boundingBox();
  await page.evaluate(() => (window as any).inlineTest.resolve());
  await expect(approval).toContainText('Provided securely');
  await expect(approval.locator('.wd-inline-panel-ghost')).toHaveCount(1);
  expect(await approval.locator('.wd-inline-panel-frame').evaluate(node => node.getAnimations().some(animation => animation.playState === 'running'))).toBe(true);
  await expect(approval.locator('.wd-inline-panel-ghost')).toHaveCount(0);
  const after = await approval.boundingBox();
  expect(before?.height).toBeGreaterThan(after?.height ?? 0);
  await expect(approval.locator('button')).toHaveCount(0);
});

for (const native of [false, true]) test(`inline history stays above a reply through acknowledgement (${native ? 'native' : 'web'})`, async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => sessionStorage.removeItem('Dash:inline:inline-test'));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-inline-id]')).toHaveCount(3);
  if (native) await page.evaluate(() => (window as any).inlineTest.native());
  await page.evaluate(() => {
    const samples: Array<{ y: number; ids: string[] }> = [];
    (window as any).samples = samples;
    const sample = () => {
      const bubble = document.querySelector('[data-message-id="reply"] .wd-bubble, [data-message-id="server-reply"] .wd-bubble');
      if (bubble) samples.push({ y: bubble.getBoundingClientRect().top, ids: Array.from(document.querySelectorAll('[data-inline-id], [data-message-id]')).map(node => node.getAttribute('data-inline-id') || node.getAttribute('data-message-id')!) });
      if (document.querySelector('.wd')?.hasAttribute('data-sending-message')) requestAnimationFrame(sample);
    };
    (window as any).inlineTest.send(); requestAnimationFrame(sample);
  });
  await expect(page.locator('[data-message-id="server-reply"]')).toBeVisible();
  await expect(page.locator('.wd-send-flight')).toHaveCount(0);
  const samples = await page.evaluate(() => (window as any).samples);
  expect(samples.length).toBeGreaterThan(4);
  for (const sample of samples) {
    const reply = Math.max(sample.ids.indexOf('reply'), sample.ids.indexOf('server-reply'));
    expect(sample.ids.indexOf('approval:1')).toBeLessThan(reply);
    expect(sample.ids.indexOf('error')).toBeLessThan(reply);
    expect(sample.ids.indexOf('wait')).toBeLessThan(reply);
  }
  const positions = samples.slice(2, -1).map((sample: { y: number }) => sample.y);
  expect(Math.max(...positions) - Math.min(...positions), 'acknowledgement must not move the landing target during flight').toBeLessThan(2);
  await expect(page.locator('[data-inline-id="approval:1"] button')).toHaveCount(0);
  await expect(page.locator('[data-inline-id="error"] button')).toHaveCount(0);
  await expect(page.locator('[data-inline-id="wait"]')).toHaveAttribute('data-inline-active', 'true');
  await page.getByRole('button', { name: 'Failed message options' }).click();
  await page.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(page.locator('[data-message-id="failed-message"]')).not.toHaveClass(/is-failed/);
  await page.screenshot({ path: `/tmp/wdyt-inline-timeline-${native ? 'native' : 'web'}.png` });
  await page.evaluate(() => { document.documentElement.dataset.appearance = 'dark'; (window as any).inlineTest.stop(); });
  await expect(page.locator('[data-inline-id="wait"]')).toContainText('Waiting ended');
  await page.screenshot({ path: `/tmp/wdyt-inline-timeline-${native ? 'native' : 'web'}-dark.png` });
  await page.evaluate(() => (window as any).remountInline());
  await expect(page.locator('[data-inline-id]')).toHaveCount(3);
  await expect(page.locator('[data-inline-active="true"]')).toHaveCount(0);
  await expect(page.getByLabel('Your response', { exact: true })).toHaveCount(1);
  await expect(page.locator('.wd-thread')).not.toContainText('Earlier request');
  const order = await page.locator('[data-inline-id], [data-message-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-inline-id') || node.getAttribute('data-message-id')));
  expect(order.indexOf('wait')).toBeLessThan(order.indexOf('server-reply'));
  await page.reload();
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => { (window as any).restoreInlineFixture = true; });
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-inline-id]')).toHaveCount(3);
  await expect(page.locator('[data-inline-active="true"]')).toHaveCount(0);
  await expect(page.getByLabel('Your response', { exact: true })).toHaveCount(1);
  await expect(page.locator('.wd-thread')).not.toContainText('Earlier request');
});

test('reduced motion resolves inline panels without a flight or reserved blank space', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => sessionStorage.removeItem('Dash:inline:inline-test'));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-inline-id]')).toHaveCount(3);
  await page.evaluate(() => (window as any).inlineTest.send());
  await expect(page.locator('[data-inline-id="approval:1"]')).toContainText('Provided securely');
  await expect(page.locator('.wd-send-flight')).toHaveCount(0);
  expect(await page.locator('[data-inline-id="approval:1"]').evaluate(node => (node as HTMLElement).style.height)).toBe('');
});

test('a new server error waits until the outgoing message lands', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => sessionStorage.removeItem('Dash:inline:inline-test'));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-inline-id]')).toHaveCount(3);
  await page.evaluate(() => { (window as any).inlineTest.send(); (window as any).inlineTest.error(); });
  await expect(page.locator('.wd-send-flight')).toHaveCount(1);
  await expect(page.locator('[data-inline-id="late-error"]')).toHaveCount(0);
  await expect(page.locator('.wd-send-flight')).toHaveCount(0);
  await expect(page.locator('[data-inline-id="late-error"]')).toContainText('A new error arrived.');
});

test('cached generic approval receipts leave no rows or gaps', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => {
    (window as any).restoreInlineFixture = true;
    (window as any).cachedGenericReceipts = [1, 2, 3].map(id => ({ id: `answers:generic-${id}`, kind: 'answers', compact: true, answers: [{ question: 'Requested action', answer: 'Approved' }] }));
    sessionStorage.setItem('Dash:inline:inline-test', JSON.stringify([1, 2, 3].map(id => ({ id: `approval:generic-${id}`, summary: 'Requested action · Approved', replaces: `answers:generic-${id}` }))));
  });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText('I can check that for you.', { exact: true })).toBeVisible();
  await expect(page.getByText('Requested action', { exact: false })).toHaveCount(0);
  await expect(page.locator('[data-inline-id^="approval:generic-"]')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/dash-no-generic-approval-rows.png' });
});

for (const readingHistory of [false, true]) test(`inline arrival while typing ${readingHistory ? 'announces an offscreen card' : 'stays visible at the bottom'}`, async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.evaluate(() => sessionStorage.removeItem('Dash:inline:inline-test'));
  await page.setContent('<div id="root"></div>');
  for (const file of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  await page.addScriptTag({ content: bundle });
  const chat = page.locator('.wd-task');
  await chat.evaluate(el => {
    el.style.height = '500px';
    el.querySelector('.wd-thread')!.insertAdjacentHTML('afterbegin','<div style="height:900px;flex:none">Earlier conversation</div>');
  });
  await expect.poll(() => chat.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const input = page.locator('textarea');
  await input.fill('Keep this unsent draft');
  await chat.evaluate((el, history) => { el.scrollTop = history ? 0 : el.scrollHeight; el.dispatchEvent(new Event('scroll')); }, readingHistory);
  await page.waitForTimeout(100);
  const before = await chat.evaluate(el => el.scrollTop);
  await page.evaluate(() => (window as any).inlineTest.error());
  await expect(page.locator('[data-inline-id="late-error"]')).toContainText('A new error arrived.');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Keep this unsent draft');
  if (readingHistory) {
    await expect(page.getByRole('button', {name:'New messages'})).toBeVisible();
    expect(await chat.evaluate(el => el.scrollTop)).toBeCloseTo(before, 0);
  } else {
    await expect.poll(() => chat.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  }
});
