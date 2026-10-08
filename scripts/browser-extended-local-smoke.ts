import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
import { ONE_SHOT_INSTRUMENTATION } from './browser-one-shot-instrumentation';

// The pinned Playwright Chromium keeps this fixture independent of the user's
// Chrome version/profile. The production transport is tested separately against Browserless.
const dir = mkdtempSync('/tmp/dash-browser-parity-');
const chrome = spawn(chromium.executablePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore', detached: true });
try {
  let port = '';
  for (let i = 0; i < 100; i++) {
    try { port = readFileSync(dir + '/DevToolsActivePort', 'utf8').split('\n')[0]; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!port) throw new Error('Fixture Chromium did not start');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as {webSocketDebuggerUrl: string};
  const transport = readFileSync(new URL('./fixtures/browser-controller-local.py', import.meta.url), 'utf8').split('with tempfile.TemporaryDirectory() as d:')[0];
  const body = readFileSync(new URL(process.argv.includes('--page-keyboard') ? './fixtures/browser-page-keyboard-local.py' : './fixtures/browser-extended-local.py', import.meta.url), 'utf8');
  const instrumentation = process.argv.includes('--one-shot')
    ? `\nns['CDP']=LocalCDP\nexec(${JSON.stringify(ONE_SHOT_INSTRUMENTATION)},ns)\nns['CDP']=connect\n` : '';
  const program = `controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\nendpoint=${JSON.stringify(version.webSocketDebuggerUrl)}\nd=${JSON.stringify(dir)}\n` + transport + instrumentation + body;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-u', '-c', program], { stdio: 'inherit' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code ? reject(new Error(`Fixture exited ${code}`)) : resolve(); });
  });
} finally {
  if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
  await new Promise(resolve => setTimeout(resolve, 200));
  rmSync(dir, { recursive: true, force: true });
}
