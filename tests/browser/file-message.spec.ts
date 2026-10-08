import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { artifactResponse } from '../../lib/harness/artifact-response';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/file-message.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
let server: Server;
let origin: string;
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.url?.startsWith('/api/runs/file-test/artifacts/')) {
      const file = artifactResponse(new Request(`${origin}${request.url}`), { name: 'Project files.custom', mimeType: 'application/octet-stream', bytesBase64: Buffer.from('original project bytes').toString('base64') });
      response.writeHead(file.status, Object.fromEntries(file.headers));
      response.end(Buffer.from(await file.arrayBuffer()));
    } else { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<div id="root"></div>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

for (const dark of [false, true]) test(`files preview and save from chat (${dark ? 'dark' : 'light'})`, async ({ page }) => {
  await page.goto(origin);
  for (const file of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  if (dark) await page.evaluate(() => document.documentElement.dataset.appearance = 'dark');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole('link', { name: 'Open Trip itinerary.pdf', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Trip budget.xlsx', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open My report.pdf', exact: true })).toBeVisible();
  await expect(page.locator('.wd-bubble.is-me').filter({ hasText: 'Please review this document.' })).not.toContainText('Attached:');
  await page.getByRole('link', {name:'Open Trip itinerary.pdf',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.wd-document-content iframe')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', {name:'Close document'}).click();
  const link = page.getByRole('link', { name: 'Open Project files.custom', exact: true });
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(393);
  await page.screenshot({ path: `/tmp/dash-files-${dark ? 'dark' : 'light'}.png` });
  await link.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('This file type can’t be previewed in this browser.')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', {name:'Save file',exact:true}).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Project files.custom');
  expect(readFileSync((await download.path())!, 'utf8')).toBe('original project bytes');
  await page.getByRole('button', {name:'Close document'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.wd-reaction-overlay')).toHaveCount(0);
  await expect(page.getByText('Here are your files.', { exact: true })).toBeVisible();
});

test('a PDF stays visible when the first send hands off to the server snapshot', async ({ page }) => {
  let finishUpload!: () => void;
  const uploaded = new Promise<void>(resolve => { finishUpload = resolve; });
  await page.route('**/api/runs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    await uploaded;
    const now = new Date().toISOString();
    await route.fulfill({ json: {
      id: 'pdf-handoff', userId: 'preview@example.com', decisionId: body.decisionId, category: 'social',
      request: body.request, title: 'Review PDF', response: '', result: null, status: 'planning', error: null,
      createdAt: now, updatedAt: now, completedAt: null,
      metadata: { ...body.metadata, initialAttachmentIds: ['pdf-upload'], initialAttachmentNames: { 'pdf-upload': 'Review.pdf' } },
      actions: [], steps: [], events: [], artifacts: [{ id: 'pdf-upload', runId: 'pdf-handoff', actionId: null, name: 'uploaded-Review.pdf', mimeType: 'application/pdf', createdAt: now }],
    } });
  });
  await page.goto('/?uiPreview=1');
  const composer = page.locator('.wd-home-layer .wd-composer');
  await composer.locator('input[type="file"]:not([data-photos])').setInputFiles({ name: 'Review.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await composer.locator('textarea').fill('Please review this PDF.');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  const file = page.getByRole('link', { name: 'Open Review.pdf', exact: true });
  await expect(file).toBeVisible();
  finishUpload();
  await expect(file).toHaveAttribute('href', '/api/runs/pdf-handoff/artifacts/pdf-upload?download=1');
  await expect(file).toBeVisible();
  const text = page.locator('.wd-front-layer .wd-bubble.is-me').filter({ hasText: 'Please review this PDF.' });
  await expect(text).toBeVisible();
  const gap = (await text.boundingBox())!.y - ((await file.boundingBox())!.y + (await file.boundingBox())!.height);
  expect(gap).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: '/tmp/dash-pdf-handoff.png' });
});
