import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({entryPoints:['tests/browser/fixtures/browser-viewer.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
test.beforeEach(async ({ page }) => {
  await page.route('**/__browser-viewer-fixture', route => route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
});
test('new attention slides the browser down during an active touch', async ({ page }) => {
  await page.goto('/__browser-viewer-fixture');
  await page.setContent('<div id="root"></div>');
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css', 'app/browser-viewer.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  await page.addScriptTag({ content: bundle });
  const panel = page.locator('.cloud-browser-panel');
  await expect.poll(async () => Math.round((await panel.boundingBox())!.y)).toBe(0);
  await page.evaluate(() => {
    const target = document.querySelector('.cloud-browser-panel')!;
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 200, clientY: 400, button: 0 }));
    (window as any).triggerBrowserAttention();
  });
  await expect.poll(async () => (await panel.boundingBox())!.y).toBeGreaterThan(0);
  await expect(page.locator('body')).toHaveAttribute('data-closed', 'true');
  await expect(page.locator('.browser-needs-user-overlay')).toHaveCount(0);
});
for (const width of [393, 1280]) test(`full screen browser without replay at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:852});
  await page.goto('/__browser-viewer-fixture');
  await page.route('**/api/runs/viewer-test/artifacts/*', route => route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#fff"/><text x="80" y="120" font-size="36">NATURA MARKET</text><rect x="80" y="180" width="500" height="580" fill="#f3eadb"/><text x="650" y="250" font-size="32">Sour Blast Buddies</text><text x="650" y="320" font-size="24">5 packs · $21.45</text></svg>'}));
  await page.setContent('<div id="root"></div>');
  for (const file of ['app/brand-tokens.css','app/wdyt.css','app/browser-viewer.css']) await page.addStyleTag({content:readFileSync(file,'utf8')});
  await page.addScriptTag({content:bundle});
  await expect(page.locator('.browser-location')).toHaveText('Buy candy');
  await expect(page.locator('.cloud-browser-frame')).toHaveClass(/browser-fit-page/);
  await expect.poll(async()=>Math.round((await page.locator('.cloud-browser-panel').boundingBox())!.y)).toBe(0);
  const panel = (await page.locator('.cloud-browser-panel').boundingBox())!;
  expect(panel.width).toBe(width); expect(panel.height).toBeCloseTo(852, 2);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.locator('.browser-session-footer')).toHaveCount(0);
  await expect(page.locator('.cloud-browser-frame > img')).toHaveAttribute('src', /artifacts\/last$/);
  const frame = (await page.locator('.cloud-browser-frame').boundingBox())!;
  expect(frame.y + frame.height / 2).toBeCloseTo(panel.height / 2, 0);
  if (width < 761) {
    expect(await page.locator('.cloud-browser-frame').evaluate(n => n.scrollWidth > n.clientWidth)).toBe(false);
    await page.evaluate(()=>document.documentElement.classList.add('decision-feed-native'));
  }
  await page.screenshot({path:`/tmp/wdyt-browser-full-${width}.png`});
  await page.evaluate(()=>document.documentElement.dataset.appearance='dark');
  await page.screenshot({path:`/tmp/wdyt-browser-full-${width}-dark.png`});
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button',{name:'Take over',exact:true}).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Take over the browser?'); await dialog.accept(); });
  await page.getByRole('button',{name:'Take over',exact:true}).click();
  await expect(page.locator('iframe')).toHaveAttribute('src',/control=1/);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-resume-calls', '1');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-closed','true');
});

for (const dark of [false, true]) test(`browser shows loading through delayed frame and takeover navigation (${dark ? 'dark' : 'light'})`, async ({ page }) => {
  await page.goto('/__browser-viewer-fixture');
  let releaseFrame!: () => void;
  let releaseBrowser!: () => void;
  const frameGate = new Promise<void>(resolve => { releaseFrame = resolve; });
  const browserGate = new Promise<void>(resolve => { releaseBrowser = resolve; });
  await page.route('**/api/runs/viewer-test/artifacts/*', async route => {
    await frameGate;
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><text x="20" y="50">Browser ready</text></svg>' });
  });
  await page.route('**/api/runs/viewer-test/browser?control=1', async route => {
    await browserGate;
    await route.fulfill({ contentType: 'text/html', body: '<p>Interactive browser ready</p>' });
  });
  await page.setContent('<div id="root"></div>');
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css', 'app/browser-viewer.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  if (dark) await page.evaluate(() => document.documentElement.dataset.appearance = 'dark');
  await page.addScriptTag({ content: bundle });
  const loading = page.getByRole('status').filter({ hasText: 'Connecting to browser…' });
  await expect(loading).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator('.cloud-browser-panel').boundingBox())!.y)).toBe(0);
  await page.screenshot({ path: `/tmp/dash-browser-loading-${dark ? 'dark' : 'light'}.png` });
  releaseFrame();
  await expect(loading).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Take over', exact: true }).click();
  await expect(loading).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  releaseBrowser();
  await expect(page.frameLocator('iframe').getByText('Interactive browser ready')).toBeVisible();
  await expect(loading).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveAttribute('aria-busy', 'false');
});

for (const width of [393, 1280]) test(`live view streams without screenshot polling at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  await page.goto('/__browser-viewer-fixture');
  let screenshotRequests = 0;
  page.on('request', request => { if (request.url().includes('/browser/frame')) screenshotRequests++; });
  await page.route('**/api/runs/viewer-test/browser?control=*', route => route.fulfill({ contentType: 'text/html', body: '<p>Continuous browser stream</p>' }));
  await page.route('**/api/runs/viewer-test/artifacts/*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><text x="40" y="80">Recorded step</text></svg>' }));
  await page.evaluate(() => { (window as any).liveBrowserFixture = true; });
  await page.setContent('<div id="root"></div>');
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css', 'app/browser-viewer.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('iframe')).toHaveAttribute('src', /control=0/);
  await expect(page.frameLocator('iframe').getByText('Continuous browser stream')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCSS('pointer-events', 'none');
  await page.waitForTimeout(2200);
  expect(screenshotRequests).toBe(0);
  await expect(page.getByRole('slider')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Take over', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /control=1/);
  await expect(page.locator('iframe')).toHaveCSS('pointer-events', 'auto');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /control=0/);
  await expect(page.locator('body')).toHaveAttribute('data-resume-calls', '1');
});

for (const status of ['waiting', 'failed', 'needs_approval']) test(`takeover is disabled for ${status} tasks, including stale control requests`, async ({page}) => {
  await page.goto('/__browser-viewer-fixture');
  await page.setContent('<div id="root"></div>');
  await page.evaluate(status => { (window as any).viewerStatus=status; (window as any).viewerControlRequested=true; }, status);
  await page.addScriptTag({content:bundle});
  await expect(page.getByRole('button',{name:'Take over',exact:true})).toBeDisabled();
  await expect(page.locator('iframe[src*="control=1"]')).toHaveCount(0);
});
test('ending a task removes interactive control from an open viewer', async ({page}) => {
  await page.goto('/__browser-viewer-fixture');
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => { (window as any).viewerControlRequested=true; });
  await page.addScriptTag({content:bundle});
  await expect(page.locator('iframe[src*="control=1"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).setViewerStatus('waiting'));
  await expect(page.locator('iframe[src*="control=1"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Take over',exact:true})).toBeDisabled();
});

test('lost creator connection reloads only the viewer, then stops polling on dismissal', async ({ page }) => {
  await page.goto('/__browser-viewer-fixture');
  let loads = 0;
  let healthReads = 0;
  await page.route('**/api/runs/viewer-test/browser?*', route => {
    if (new URL(route.request().url()).searchParams.has('health')) {
      healthReads++;
      return route.fulfill({ json: { state: loads === 1 ? 'reconnect' : 'connected' } });
    }
    loads++;
    return route.fulfill({ contentType: 'text/html', body: loads === 1 ? '<p>All done!</p>' : '<p>Live browser recovered</p>' });
  });
  await page.evaluate(() => { (window as any).liveBrowserFixture = true; (window as any).viewerControlRequested = true; });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.frameLocator('iframe').getByText('Live browser recovered')).toBeVisible();
  expect(loads).toBe(2);
  await page.evaluate(() => (window as any).setViewerStatus('waiting'));
  await expect.poll(() => loads).toBe(3);
  const readsAtStop = healthReads;
  await page.waitForTimeout(5500);
  expect(healthReads).toBe(readsAtStop);
  expect(loads).toBe(3);
});

test('reconnect is bounded and an expired session is not restarted', async ({ page }) => {
  await page.goto('/__browser-viewer-fixture');
  let loads = 0;
  let state = 'reconnect';
  await page.route('**/api/runs/viewer-test/browser?*', route => {
    if (new URL(route.request().url()).searchParams.has('health')) return route.fulfill({ json: { state } });
    loads++;
    return route.fulfill({ contentType: 'text/html', body: '<p>All done!</p>' });
  });
  await page.evaluate(() => { (window as any).liveBrowserFixture = true; (window as any).viewerControlRequested = true; });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible({ timeout: 10000 });
  expect(loads).toBe(4);
  state = 'unavailable';
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.getByText('Live view ended. Return to the conversation.')).toHaveCount(0);
  expect(loads).toBe(5);
});

test('temporary passive stream unavailability does not cover a working browser', async ({ page }) => {
  await page.goto('/__browser-viewer-fixture');
  let state = 'unavailable';
  let reads = 0;
  await page.route('**/api/runs/viewer-test/browser?*', route => {
    if (new URL(route.request().url()).searchParams.has('health')) {
      reads++;
      return route.fulfill({ json: { state } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<p>Browser still working</p>' });
  });
  await page.evaluate(() => { (window as any).liveBrowserFixture = true; });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.getByText('Live view ended. Return to the conversation.')).toHaveCount(0);
  await expect(page.frameLocator('iframe').getByText('Browser still working')).toBeVisible();
  state = 'inactive';
  await expect(page.getByText('Live view ended. Return to the conversation.')).toBeVisible({ timeout: 8000 });
});

test('watch-to-takeover mode change waits for the control stream instead of ending', async ({ page }) => {
  await page.goto('/__browser-viewer-fixture');
  let reads = 0;
  await page.route('**/api/runs/viewer-test/browser?*', route => {
    if (new URL(route.request().url()).searchParams.has('health')) {
      reads++;
      return route.fulfill({ json: { state: reads === 1 ? 'mode_changed' : 'connected' } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<p>Takeover ready</p>' });
  });
  await page.evaluate(() => { (window as any).liveBrowserFixture = true; (window as any).viewerControlRequested = true; });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => reads, { timeout: 10000 }).toBeGreaterThan(1);
  await expect(page.getByText('Live view ended. Return to the conversation.')).toHaveCount(0);
  await expect(page.frameLocator('iframe').getByText('Takeover ready')).toBeVisible();
});
