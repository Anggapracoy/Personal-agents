import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/startup.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' } }).outputFiles.find((file: {path: string}) => file.path.endsWith('.js') || file.path === '<stdout>')!.text;
for (const saved of ['current', 'other', 'none']) test(`startup readiness with ${saved} account cache`, async ({ page }) => {
  page.on('pageerror', error => console.error(error.message));
  await page.route('**/startup-fixture', route => route.fulfill({contentType:'text/html', body:'<div id="root"></div>'}));
  await page.goto('http://localhost:3000/startup-fixture');
  await page.evaluate(saved => {
    const w = window as any;
    w.bridge = []; w.writes = [];
    w.webkit = {messageHandlers:{decisionFeedNative:{postMessage:(message: unknown) => w.bridge.push(message)}}};
    if (saved !== 'none') localStorage.setItem(`wdyt-conversation-list-v1:${saved === 'current' ? 'startup' : 'other'}@example.com`, JSON.stringify({decisions:[],tasks:[],history:[{id:'saved-chat',title:'Saved dinner plans',subtitle:'See you at seven',category:'social',completedAt:new Date().toISOString(),time:'now',group:'TODAY',status:'done',originalContext:'Dinner',chosenOption:'Plan dinner',steps:[],outcome:'See you at seven'}],settings:{},messages:{}}));
    w.fetch = (url: string, options?: RequestInit) => {
      if (options?.method && options.method !== 'GET') w.writes.push(url);
      if (String(url) === '/api/workspace/state' && !options?.method) return new Promise(resolve => {
        w.finishState = () => resolve(new Response(JSON.stringify({exists:true,version:1,state:{decisions:[],tasks:[],history:[],discardedDecisionIds:[]},preferences:{appearance:'system',modelSettings:{}}}),{status:200}));
      });
      return new Promise(() => {});
    };
  }, saved);
  await page.addStyleTag({content:['globals.css','brand-tokens.css','wdyt.css'].map(file => readFileSync(`app/${file}`, 'utf8').replace(/@import[^;]+;/g, '')).join('\n')});
  await page.addScriptTag({content:bundle});
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishState)).toBe('function');
  if (saved === 'current') await expect.poll(() => page.evaluate(() => (window as any).bridge.filter((m:any) => m.action === 'workspaceReady').length)).toBe(1);
  else expect(await page.evaluate(() => (window as any).bridge.filter((m:any) => m.action === 'workspaceReady'))).toHaveLength(0);
  if (saved === 'current') {
    await expect(page.getByText('Saved dinner plans')).toBeVisible();
    await page.screenshot({path:'/tmp/dash-startup-cached-home.png'});
  } else await expect(page.getByText('Saved dinner plans')).toHaveCount(0);
  await expect(page.getByPlaceholder('Message Dash…')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).writes.filter((url:string) => url === '/api/workspace/state'))).toHaveLength(0);
  await page.evaluate(() => (window as any).finishState());
  await expect(page.getByPlaceholder('Message Dash…')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as any).bridge.filter((m:any) => m.action === 'workspaceReady').length)).toBe(1);
});
