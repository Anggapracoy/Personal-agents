import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/voice-cancel.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
for (const working of [false, true]) for (const native of [false, true]) for (const phase of ['requesting', 'recording', 'transcribing']) test(`${native ? 'native' : 'web'} X cancels ${phase}${working ? ' while a task is working' : ''}`, async ({ page }) => {
  await page.route('**/voice-cancel-fixture*', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  page.on('pageerror', error => console.error(error));
  await page.goto(`http://127.0.0.1:3000/voice-cancel-fixture?native=${native ? 1 : 0}&working=${working ? 1 : 0}`);
  await page.evaluate(() => {
    const w = window as any;
    w.stops = 0; w.uploads = 0; w.aborted = false;
    w.AudioContext = undefined; w.webkitAudioContext = undefined;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(resolve => { w.grantMic = () => resolve({ getTracks: () => [{ stop: () => w.stops++ }] }); }) } });
    w.MediaRecorder = class extends EventTarget {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/mp4';
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; queueMicrotask(() => { const event = new Event('dataavailable'); Object.assign(event, { data: new Blob(['a'.repeat(500)]) }); this.dispatchEvent(event); this.dispatchEvent(new Event('stop')); }); }
    };
    w.fetch = (_url: string, options: RequestInit) => new Promise(resolve => {
      w.uploads++; options.signal?.addEventListener('abort', () => { w.aborted = true; });
      // Deliberately resolve even after cancellation to test stale-response protection.
      w.finishUpload = () => resolve({ ok: true, json: async () => ({ text: 'Unwanted transcript' }) });
    });
  });
  await page.addScriptTag({ content: bundle });
  const action = async (kind: 'voice' | 'cancelVoice') => {
    if (native) {
      await expect.poll(() => page.evaluate(() => (window as any).bridge.some((m: any) => m.action === 'composerState'))).toBe(true);
      await page.evaluate(kind => { const w = window as any; const state = w.bridge.findLast((m: any) => m.action === 'composerState').payload; window.dispatchEvent(new CustomEvent('decisionFeed:composerAction', { detail: { id: state.id, action: kind } })); }, kind);
    } else if (kind === 'cancelVoice') await page.locator('.wd-composer-plus').click();
    else await page.locator('.voice-input-trigger, .voice-input-stop').click();
  };
  if(working && !native) { await expect(page.getByRole('button',{name:'Stop task',exact:true})).toBeVisible(); await expect(page.locator('.voice-input-trigger')).toBeVisible(); }
  await action('voice');
  if(working) expect(await page.evaluate(()=>(window as any).taskStops??0)).toBe(0);
  await expect(page.locator('.voice-input')).toHaveClass(/requesting/);
  if (phase !== 'requesting') {
    await page.evaluate(() => (window as any).grantMic());
    await expect(page.locator('.voice-input')).toHaveClass(/recording/);
  }
  if (phase === 'transcribing') { await action('voice'); await expect.poll(() => page.evaluate(() => (window as any).uploads)).toBe(1); }
  await action('cancelVoice');
  await expect(page.locator('.voice-input')).toHaveClass(/idle/);
  if (phase === 'requesting') await page.evaluate(() => (window as any).grantMic());
  if (phase === 'transcribing') { await expect.poll(() => page.evaluate(() => (window as any).aborted)).toBe(true); await page.evaluate(() => (window as any).finishUpload()); }
  await expect.poll(() => page.evaluate(() => (window as any).stops)).toBeGreaterThan(0);
  await expect(page.getByTestId('text')).toBeEmpty();
  expect(await page.evaluate(() => (window as any).uploads)).toBe(phase === 'transcribing' ? 1 : 0);
});

test('cancel still releases microphone when recorder.stop throws', async ({ page }) => {
  await page.route('**/voice-cancel-fixture*', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('/voice-cancel-fixture');
  await page.evaluate(() => {
    const w = window as any;
    w.stops = 0; w.uploads = 0;
    w.AudioContext = undefined; w.webkitAudioContext = undefined;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => w.stops++ }] }) } });
    w.MediaRecorder = class extends EventTarget {
      static isTypeSupported() { return true; }
      state = 'inactive';
      start() { this.state = 'recording'; }
      stop() { throw new DOMException('Recorder already stopped', 'InvalidStateError'); }
    };
    w.fetch = () => { w.uploads++; throw Error('Cancelled audio must not upload'); };
  });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Use voice input' }).click();
  await expect(page.locator('.voice-input')).toHaveClass(/recording/);
  await page.locator('.wd-composer-plus').click();
  await expect(page.locator('.voice-input')).toHaveClass(/idle/);
  expect(await page.evaluate(() => (window as any).stops)).toBe(1);
  expect(await page.evaluate(() => (window as any).uploads)).toBe(0);
  await expect(page.getByTestId('text')).toBeEmpty();
});
