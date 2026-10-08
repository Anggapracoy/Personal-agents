import { test, expect } from '@playwright/test';

test('chat identity saves, survives reload, without losing the conversation', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  const trigger = page.getByRole('button', { name: /^Chat details for / });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Chat details', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'No files yet' })).toBeVisible();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Chat name', exact: true }).fill('Lisbon plans');
  await panel.getByRole('button', { name: 'Use cloud', exact: true }).click();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Lisbon plans', exact: true })).toBeVisible();
  await expect(panel.locator('.wd-details-scroll:not([aria-hidden]) [data-character="cloud"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/chat-details/details-light.png' });
  await panel.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(trigger).toHaveAccessibleName('Chat details for Lisbon plans');
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await trigger.click();
  await expect(panel.getByRole('heading', { name: 'Lisbon plans', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Chat emoji', exact: true }).fill('🌴');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel.locator('.wd-details-scroll:not([aria-hidden]) .wd-custom-avatar')).toHaveText('🌴');
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.locator('input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64') });
  await expect(panel.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel.locator('.wd-details-scroll:not([aria-hidden]) .wd-custom-avatar img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Reset name and icon to default' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await panel.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('details stays usable in dark appearance and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await page.evaluate(() => document.documentElement.dataset.appearance = 'dark');
  await page.getByRole('button', { name: /^Chat details for / }).click();
  const panel = page.getByRole('dialog', { name: 'Chat details', exact: true });
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.screenshot({ path: 'artifacts/chat-details/editor-dark.png' });
  await panel.getByRole('textbox', { name: 'Chat name', exact: true }).fill('');
  await expect(panel.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await panel.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('details expands from the header and can reverse before opening finishes', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await expect(page.getByRole('button', { name: /^Chat details for / })).toBeVisible();
  const samples = await page.evaluate(async () => {
    const trigger = document.querySelector<HTMLButtonElement>('.wd-taskbar-title')!;
    const source = trigger.querySelector('strong')!.getBoundingClientRect();
    const frames: { width: number; y: number; height: number }[] = [];
    trigger.click();
    const start = performance.now();
    await new Promise<void>(resolve => {
      const tick = () => {
        const panel = document.querySelector('.wd-details-panel');
        if (panel) { const r = panel.getBoundingClientRect(); frames.push({ width: r.width, height: r.height, y: r.y }); }
        if (performance.now() - start < 600) requestAnimationFrame(tick); else resolve();
      }; requestAnimationFrame(tick);
    });
    return { frames, sourceY: source.y, sourceHeight: source.height, width: innerWidth, height: innerHeight };
  });
  expect(Math.min(...samples.frames.map(frame => frame.width))).toBeLessThan(samples.width * .8);
  expect(Math.max(...samples.frames.map(frame => frame.y))).toBeLessThan(samples.sourceY + samples.sourceHeight);
  expect(samples.frames.at(-1)!.width).toBeCloseTo(samples.width, 0);
  expect(samples.frames.at(-1)!.height).toBeCloseTo(samples.height, 0);
  await expect(page.locator('.wd-details-identity > .wd-icon')).toHaveCSS('width', '112px');
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('.wd-details-panel')).toHaveCount(0);
  await page.getByRole('button', { name: /^Chat details for / }).dispatchEvent('click');
  await expect(page.locator('.wd-details-panel')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wd-details-panel')).toHaveCount(0);
  await expect(page.locator('.wd-details-avatar-flight')).toHaveCount(0);
});

test('avatar stays stationary and opaque through Edit and back', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await page.getByRole('button', { name: /^Chat details for / }).click();
  await page.waitForTimeout(600);
  for (const label of ['Edit', 'Cancel editing']) {
    const samples = await page.evaluate(async label => {
      const panel = document.querySelector('.wd-details-panel')!;
      const avatar = () => panel.querySelector('.wd-details-scroll:not([aria-hidden]) .wd-details-identity > .wd-icon')!;
      const measure = () => {
        const node = avatar(), r = node.getBoundingClientRect();
        let opacity = 1;
        for (let el: Element | null = node; el && el !== panel; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity);
        return { x: r.x, y: r.y, opacity };
      };
      const result = [measure()];
      (panel.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();
      const start = performance.now();
      await new Promise<void>(resolve => {
        const tick = () => { result.push(measure()); if (performance.now() - start < 300) requestAnimationFrame(tick); else resolve(); };
        requestAnimationFrame(tick);
      });
      return result;
    }, label);
    for (const axis of ['x', 'y'] as const) expect(Math.max(...samples.map(s => s[axis])) - Math.min(...samples.map(s => s[axis]))).toBeLessThan(1);
    expect(Math.min(...samples.map(s => s.opacity))).toBe(1);
  }
});

for (const direction of ['right', 'down'] as const) test(`details follows a ${direction} touch swipe and dismisses`, async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await page.getByRole('button', { name: /^Chat details for / }).click();
  const panel = page.locator('.wd-details-panel');
  await expect(panel).toHaveAttribute('data-details-progress', '1.000');
  const progress = await panel.evaluate((element, direction) => {
    const target = element.querySelector('h1')!;
    const emit = (type: string, x: number, y: number) => {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch], changedTouches: [touch] }));
    };
    emit('touchstart', 250, 250);
    emit('touchmove', direction === 'right' ? 380 : 250, direction === 'down' ? 380 : 250);
    const progress = Number((element as HTMLElement).dataset.detailsProgress);
    if (direction === 'right') {
      const rect = element.getBoundingClientRect();
      if (Math.abs(rect.x - 130) > 1 || Math.abs(rect.width - innerWidth) > 1)
        throw new Error('Right swipe must translate the full-width panel right with the finger');
    }
    emit('touchend', 120, 380);
    return progress;
  }, direction);
  expect(progress).toBeLessThan(.9);
  await expect(panel).toHaveCount(0);
});

for (const direction of ['right', 'down'] as const) test(`a cancelled ${direction} swipe restores the full panel`, async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await page.getByRole('button', { name: /^Chat details for / }).click();
  const panel = page.locator('.wd-details-panel');
  await expect(panel).toHaveAttribute('data-details-progress', '1.000');
  await panel.evaluate((element, direction) => {
    const target = element.querySelector('h1')!;
    for (const [type, y] of [['touchstart', 250], ['touchmove', 300], ['touchcancel', 300]] as const) {
      const touch = new Touch({ identifier: 1, target, clientX: direction === 'right' ? y : 200, clientY: direction === 'right' ? 250 : y });
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchcancel' ? [] : [touch], changedTouches: [touch] }));
    }
  }, direction);
  await expect(panel).toHaveAttribute('data-details-progress', '1.000');
});

test('shared links show preview thumbnails and retain a text fallback', async ({ page }) => {
  await page.route('**/api/link-preview?url=*', async route => {
    const url = new URL(route.request().url()).searchParams.get('url')!;
    await route.fulfill({ json: { preview: { url, title: 'Website preview', domain: new URL(url).hostname, ...(url.includes('apple.com') ? { image: '/og-image.png' } : {}) } } });
  });
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await page.getByRole('button', { name: /^Chat details for / }).click();
  const links = page.getByRole('region', { name: 'Shared links' });
  await expect(links.getByRole('link')).toHaveCount(2);
  await expect(links.locator('img')).toHaveCount(1);
  await expect.poll(() => links.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(links.getByRole('link', { name: /Toronto Blue Jays/ })).toContainText('mlb.com');
});

test('right-to-left swipe leaves chat details open', async ({ page }) => {
  await page.goto('/?uiPreview=1&task=preview-send-reference');
  await page.getByRole('button', { name: /^Chat details for / }).click();
  const panel = page.locator('.wd-details-panel');
  await expect(panel).toHaveAttribute('data-details-progress', '1.000');
  await panel.evaluate(element => {
    const target = element.querySelector('h1')!;
    for (const [type, x] of [['touchstart', 250], ['touchmove', 100], ['touchend', 100]] as const) {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: 250 });
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch], changedTouches: [touch] }));
    }
  });
  await expect(panel).toHaveAttribute('data-details-progress', '1.000');
});
