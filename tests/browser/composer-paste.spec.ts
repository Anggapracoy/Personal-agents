import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints: ['tests/browser/fixtures/composer-paste.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text;
let server: Server;
let origin: string;
test.beforeAll(async () => {
  server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<div id="root"></div>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

for (const variant of ['home', 'thread']) {
  test(`${variant} composer appends pasted files, preserves text, and sends original file bytes`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`${origin}/?variant=${variant}`);
    for (const file of ['app/brand-tokens.css', 'app/wdyt.css']) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
    await page.addScriptTag({ content: bundle });
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(input).toHaveValue('Existing draft');
    await input.evaluate(element => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['%PDF-test-original'], 'Notes.pdf', { type: 'application/pdf' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('files')).toHaveText('Notes.pdf');
    await expect(input).toHaveValue('Existing draft');
    await input.evaluate(element => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['text-file-original'], 'Details.txt', { type: 'text/plain' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('files')).toHaveText('Notes.pdf, Details.txt');
    await expect(page.getByTestId('sent')).toBeEmpty();
    const plus = page.getByRole('button', { name: 'Add attachment', exact: true });
    const bounds = (await plus.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect(page.getByRole('group', { name: 'Attached files' })).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('group', { name: 'Attached files' })).toContainText('Notes.pdf');
    await expect(page.getByRole('group', { name: 'Attached files' })).toContainText('Details.txt');
    await page.screenshot({ path: `/tmp/dash-draft-files-${variant}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Attached files' })).toHaveCount(0);

    await page.evaluate(() => navigator.clipboard.writeText('first\nsecond'));
    await input.focus();
    await input.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
    await input.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
    await expect(input).toHaveValue('Existing draftfirst\nsecond');
    await page.screenshot({ path: `/tmp/dash-paste-${variant}.png` });
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('sent')).toContainText('Notes.pdf');
    const sent = JSON.parse(await page.getByTestId('sent').innerText());
    expect(sent.message).toBe('Existing draftfirst\nsecond');
    expect(sent.files.map((file: { dataBase64: string }) => Buffer.from(file.dataBase64, 'base64').toString())).toEqual(['%PDF-test-original', 'text-file-original']);
  });
}


test('clipboard images attach and oversized pastes preserve existing attachments', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(input).toBeVisible();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await input.focus();
  await input.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await expect(page.getByTestId('files')).toContainText('.png');
  await expect(input).toHaveValue('Existing draft');
  const before = await page.getByTestId('files').innerText();
  await input.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(3 * 1024 * 1024)], 'Too big.pdf', { type: 'application/pdf' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('alert')).toContainText('3 MB per message');
  await expect(page.getByTestId('files')).toHaveText(before);
  await expect(page.getByTestId('sent')).toBeEmpty();
});

test('a full-size camera photo is prepared and can be sent', async ({ page }) => {
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  const originalSize = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2400;
    const pixels = canvas.getContext('2d')!.createImageData(2400, 2400);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      pixels.data[offset] = Math.random() * 256;
      pixels.data[offset + 1] = Math.random() * 256;
      pixels.data[offset + 2] = Math.random() * 256;
      pixels.data[offset + 3] = 255;
    }
    canvas.getContext('2d')!.putImageData(pixels, 0, 0);
    const photo = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', 0.98));
    const input = document.querySelector('input[data-photos]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([photo], 'Pizza.jpg', { type: 'image/jpeg' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return photo.size;
  });
  expect(originalSize).toBeGreaterThan(3 * 1024 * 1024);
  await expect(page.getByTestId('files')).toContainText('Pizza.jpg');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.wd-draft-photos img')).toBeVisible();
  await expect(page.locator('.wd-draft-photos img')).toHaveJSProperty('complete', true);
  await expect(page.locator('.wd-draft-photos').getByRole('button', { name: 'Remove Pizza.jpg' })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('sent')).toContainText('Pizza.jpg');
  const sent = JSON.parse(await page.getByTestId('sent').innerText());
  expect(sent.files[0].mimeType).toBe('image/jpeg');
  expect(Buffer.from(sent.files[0].dataBase64, 'base64').length).toBeLessThan(3 * 1024 * 1024);
});
