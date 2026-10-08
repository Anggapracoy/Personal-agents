import { test, expect } from '@playwright/test';

test('photo filenames truncate and downward drags dismiss without closing on short or horizontal drags', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-call-completed-run');
  const thumbnail = page.getByRole('button', { name: 'Open photo 1: Portrait photo you sent', exact: true });
  await thumbnail.click();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toBeVisible();
  const name = viewer.locator('.wd-photo-controls span');
  await name.evaluate(el => { el.textContent = 'a-very-long-photo-filename-that-must-remain-on-one-line-even-on-a-small-iphone.jpg'; });
  await expect(name).toHaveCSS('white-space', 'nowrap');
  await expect(name).toHaveCSS('text-overflow', 'ellipsis');
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/photo-viewer-fixed.png' });
  await page.mouse.move(190, 90); await page.mouse.down(); await page.mouse.move(190, 130, { steps: 5 }); await page.mouse.up();
  await expect(viewer).toBeVisible();
  await page.mouse.move(190, 90); await page.mouse.down(); await page.mouse.move(300, 110, { steps: 5 }); await page.mouse.up();
  await expect(viewer).toBeVisible();
  await page.mouse.move(190, 90); await page.mouse.down(); await page.mouse.move(190, 260, { steps: 10 }); await page.mouse.up();
  await expect(viewer).not.toBeVisible();
  await expect(thumbnail).toBeFocused();
  await expect(thumbnail).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Enter');
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).not.toBeVisible();
  await expect(thumbnail).toBeFocused();
  await expect(thumbnail).toHaveCSS('outline-style', 'solid');
  await thumbnail.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(190, 90); await page.mouse.down(); await page.mouse.move(190, 260, { steps: 10 }); await page.mouse.up();
  await expect(viewer).not.toBeVisible();
});

test('image context-menu events are not intercepted by message actions', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-call-completed-run');
  const thumb = page.getByRole('button', { name: 'Open photo 1: Portrait photo you sent', exact: true });
  await expect(thumb).toBeVisible();
  const contextAllowed = (selector: string) => page.locator(selector).evaluate(el => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return !event.defaultPrevented;
  });
  expect(await contextAllowed('.wd-photo-thumb img')).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Message actions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Photo viewer', exact: true })).not.toBeVisible();
  await thumb.click();
  expect(await contextAllowed('.wd-photo-full img')).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Message actions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Photo viewer', exact: true })).toBeVisible();
});


test('photo opening and dismissal remain visible during motion instead of snapping closed', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-call-completed-run');
  await page.getByRole('button', { name: 'Open photo 1: Portrait photo you sent', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveCSS('opacity', '1');
  await viewer.getByRole('button', { name: 'Close photo', exact: true }).click();
  await page.waitForTimeout(100);
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveCSS('opacity', '1');
  expect(await viewer.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeGreaterThan(0);
  await expect(viewer).not.toBeVisible();
});


test('a real touch drag starting on the photo moves the entire viewer and dismisses it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/?uiPreview=1&task=preview-call-completed-run');
  await page.getByRole('button', { name: 'Open photo 1: Portrait photo you sent', exact: true }).tap();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 320 }] });
  for (const y of [340, 370, 400, 440, 480]) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y }] });
  expect(await viewer.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeGreaterThan(120);
  await expect(viewer).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/dash-photo-drag-native-touch.png' });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(viewer).not.toBeVisible();
  await context.close();
});

test('a coalesced WebKit swipe uses the pointer release when touchend has stale coordinates', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-call-completed-run');
  await page.getByRole('button', { name: 'Open photo 1: Portrait photo you sent', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await viewer.locator('img').evaluate(image => {
    const touch = new Touch({ identifier: 7, target: image, clientX: 190, clientY: 320 });
    image.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }));
    image.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 2, clientX: 190, clientY: 510 }));
    image.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }));
  });
  await expect(viewer).not.toBeVisible();
});

test('photo caption keeps its own width', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-call-completed-run');
  const turn = page.locator('.wd-reactable.is-me').filter({ has: page.locator('.wd-photo-message') }).first();
  const bubble = turn.locator('.wd-bubble.is-me');
  await bubble.evaluate(node => { node.textContent = 'Thx!'; });
  await turn.scrollIntoViewIfNeeded();
  const image = await turn.locator('.wd-photo-thumb').boundingBox();
  const caption = await bubble.boundingBox();
  expect(caption!.width).toBeLessThan(image!.width / 2);
  expect(Math.abs(caption!.x + caption!.width - image!.x - image!.width)).toBeLessThan(2);
  await page.screenshot({ path: '/tmp/dash-photo-caption-fixed.png' });
});
