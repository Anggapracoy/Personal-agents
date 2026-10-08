import { test, expect } from '@playwright/test';
test.use({ hasTouch: true, isMobile: true });

test('Settings sheet keeps detail navigation inside and dismisses with a downward touch drag', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.locator('.wd-home .wd-topbar')).toHaveCSS('opacity', '0');
  await page.screenshot({ path: 'artifacts/settings-sheet/settings-light.png' });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/settings-sheet/settings-memory.png' });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connected apps', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  await expect(page.locator('.wd-you-head strong')).toHaveCSS('color', 'rgb(244, 244, 244)');
  // Capture after the shared appearance pill finishes its 260ms transition.
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'artifacts/settings-sheet/settings-dark.png' });
  const handle = (await page.locator('.wd-settings-grabber').boundingBox())!;
  const input = await page.context().newCDPSession(page);
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 16 }] });
  await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 25 }] });
  await page.screenshot({ path: 'artifacts/settings-sheet/settings-drag.png' });
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await input.detach();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.wd-home .wd-topbar')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('button', { name: 'You', exact: true })).toBeVisible();
});

test('Settings supports reduced motion and Escape dismissal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(sheet).toHaveCSS('opacity', '1');
  await sheet.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('Home ignores Settings swipes while profile entry and back still work', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  const profile = page.getByRole('button', { name: 'You', exact: true });
  await expect(profile).toBeVisible();
  await page.evaluate(() => {
    for (const [type, x] of [['touchstart', 8], ['touchmove', 280], ['touchend', 280]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: 250 }] });
      window.dispatchEvent(event);
    }
    for (const phase of ['began', 'changed', 'ended']) window.dispatchEvent(new CustomEvent('decisionFeed:nativeSettingsSwipe', { detail: { phase, progress: 1, commit: true } }));
  });
  await expect(profile).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connected apps', exact: true })).toHaveCount(0);
  await profile.click();
  await expect(page.getByRole('button', { name: 'Connected apps', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(profile).toBeVisible();
});

test('Settings hands its moving close button to native glass only after acknowledgement', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__decisionFeedNativeBrowserClose = true;
    w.closeMessages = [];
    w.webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => {
      if (message.action === 'browserCloseState') w.closeMessages.push(message.payload);
    } } } };
  });
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings', exact: true });
  const button = page.getByRole('button', { name: 'Close Settings', exact: true });
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const latest = () => page.evaluate(() => (window as any).closeMessages.filter((m: any) => !m.hidden).at(-1));
  await expect.poll(async () => (await latest())?.label).toBe('Close Settings');
  const state = await latest();
  await expect(button).toBeVisible();
  const action = (id: string, action: string) => page.evaluate(({ id, action }) => {
    window.dispatchEvent(new CustomEvent('decisionFeed:browserCloseAction', { detail: { id, action } }));
  }, { id, action });
  await action('stale', 'ready');
  await expect(button).toBeVisible();
  await action(state.id, 'ready');
  await expect(button).toBeHidden();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toBeVisible();
  await expect.poll(async () => {
    const current = await latest();
    const rect = await page.locator('.wd-settings-page:not([inert]) .wd-settings-close').boundingBox();
    return Math.abs(current.x - rect!.x);
  }).toBeLessThan(1);
  await action(state.id, 'close');
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).closeMessages.at(-1).hidden)).toBe(true);
});

test('Settings web close expands while held and returns on release', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const button = page.getByRole('button', { name: 'Close Settings', exact: true });
  const rect = (await button.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect(button).toHaveCSS('scale', '1.16');
  await page.screenshot({ path: 'artifacts/settings-sheet/settings-close-held-web.png' });
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(button).toHaveCSS('scale', '1');
  await expect(sheet).toBeVisible();
});


test('Settings is flat and appearance uses the platform selection control', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await expect(page.getByLabel('Account overview')).toHaveCount(0);
  const appearance = page.getByRole('combobox', { name: 'Appearance', exact: true });
  await expect(appearance).toHaveValue('system');
  await appearance.selectOption('dark');
  await expect(appearance).toHaveValue('dark');
  await appearance.selectOption('light');
  await expect(appearance).toHaveValue('light');
  await appearance.selectOption('system');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByLabel('Home city')).toBeVisible();
  await expect(page.getByLabel('Other interests')).toHaveCount(0);
  await expect(page.getByLabel('Travel mode')).toHaveCount(0);
  await expect(page.getByLabel('Travel buffer')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Interests', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Response style')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Memories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved memories', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
});


test('tapping the dimmed strip above Settings dismisses it', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const bounds = (await sheet.boundingBox())!;
  await page.touchscreen.tap(100, bounds.y / 2);
  await expect(sheet).toHaveCount(0);
});

test('Native round back control waits for acknowledgement, follows movement and cleans up', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__decisionFeedNativeGlassButtons = true;
    w.glassMessages = [];
    w.webkit = { messageHandlers: { decisionFeedNative: { postMessage(message: any) { if (message.action === 'glassButtonState') w.glassMessages.push(message.payload); } } } };
  });
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Connected apps', exact: true }).click();
  const back = page.locator('.wd-glass-button[aria-label="Back"]');
  await expect(back).toHaveCSS('opacity', '1');
  await expect.poll(() => page.evaluate(() => (window as any).glassMessages.some((m: any) => m.opacity === 1 && m.symbol === 'chevron.left'))).toBe(true);
  const id = await page.evaluate(() => (window as any).glassMessages.at(-1).id);
  await page.evaluate(id => window.dispatchEvent(new CustomEvent('decisionFeed:glassButtonAction', { detail: { id, action: 'ready' } })), id);
  await expect(back).toHaveCSS('opacity', '0');
  await expect.poll(() => page.locator('.wd-settings-page').last().evaluate(el => el.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true);
  await page.locator('.wd-settings-sheet').evaluate(el => { (el as HTMLElement).style.translate = '0 60px'; });
  await expect.poll(() => page.evaluate(() => { const ms = (window as any).glassMessages.filter((m: any) => m.opacity === 1); return ms.at(-1).y - ms[0].y; })).toBeGreaterThan(50);
  await page.evaluate(id => window.dispatchEvent(new CustomEvent('decisionFeed:glassButtonAction', { detail: { id, action: 'press' } })), id);
  await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).glassMessages.some((m: any) => m.id === id && m.hidden), id)).toBe(true);
});

test('credential editors slide in and Back returns one level to the list', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Logins & cards', exact: true }).click();
  for (const name of ['School portal', 'Everyday card', 'Add login', 'Add card']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    await expect(page.locator('.wd-settings-page:not([inert]) .wd-taskbar-title strong')).toHaveText(name.startsWith('Add') ? name.replace('Add', 'New') : name);
    const keyframes = await page.locator('.wd-settings-page:not([inert])').evaluate(el => el.getAnimations().flatMap(a => (a.effect as KeyframeEffect).getKeyframes()));
    expect(keyframes.some(frame => String(frame.translate).startsWith('100%'))).toBe(true);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Logins', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cards', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Add login', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Logins', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeVisible();
});

test('right swipe returns one Settings level and cancelled swipes stay put', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Logins & cards', exact: true }).click();
  await page.getByRole('button', { name: 'School portal', exact: true }).click();
  const input = await page.context().newCDPSession(page);
  const swipe = async (cancel = false) => {
    await page.waitForTimeout(300);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 35, y: 185 }] });
    for (let i = 1; i <= 8; i++) await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 35 + i * 26, y: 185 }] });
    const layers = page.locator('.wd-settings-page');
    if (await layers.count() === 3) await expect(layers.nth(1).getByRole('heading', { name: 'Logins', exact: true, includeHidden: true })).toBeVisible();
    await input.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };
  await swipe(true);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await swipe();
  await expect(page.getByRole('heading', { name: 'Logins', exact: true })).toBeVisible();
  await swipe();
  await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeVisible();
  await swipe();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await swipe();
  await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeVisible();
  await input.detach();
});


test('back swipe reveals the retained Settings parent before release and preserves cancellation', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.waitForTimeout(320);
  const input = await page.context().newCDPSession(page);
  const parent = page.locator('.wd-settings-page[inert]');
  const active = page.locator('.wd-settings-page:not([inert]) .wd-you');
  const drag = async () => {
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 30, y: 190 }] });
    for (let i = 1; i <= 6; i++) await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 30 + i * 30, y: 190 }] });
  };
  await drag();
  expect(await active.evaluate(el => el.getBoundingClientRect().x)).toBeGreaterThan(150);
  await expect(parent.locator('.wd-you-head')).toBeVisible();
  // An inert page cannot receive input, but must remain painted in the exposed area.
  const revealed = await parent.evaluate(el => {
    const page = el.querySelector('.wd-you')!;
    const profile = el.querySelector('.wd-you-head')!;
    return { x: page.getBoundingClientRect().x, visibility: getComputedStyle(profile).visibility, opacity: getComputedStyle(profile).opacity };
  });
  expect(revealed).toEqual({ x: 0, visibility: 'visible', opacity: '1' });
  await page.screenshot({ path: 'artifacts/settings-sheet/settings-back-mid-drag.png' });
  await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(active).toHaveCSS('translate', 'none');
  await expect(page.getByLabel('Home city', { exact: true })).toBeVisible();
  await drag();
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeVisible();
  await expect(page.locator('.wd-settings-page')).toHaveCount(1);
  await input.detach();
});

test('Settings dismisses from header sides and content, without stealing scroll or field gestures', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  const input = await page.context().newCDPSession(page);
  const open = async () => {
    await page.getByRole('button', { name: 'You', exact: true }).click();
    await page.waitForTimeout(350);
  };
  const drag = async (x: number, y: number, dy: number, cancel = false) => {
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 8 }] });
    await input.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  };
  for (const x of [24, 280]) {
    await open();
    const header = (await page.locator('.wd-settings-page:not([inert]) .wd-taskbar').boundingBox())!;
    await drag(x, header.y + 20, 210);
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  }
  await open();
  const row = (await page.getByRole('button', { name: 'Preferences', exact: true }).boundingBox())!;
  await drag(row.x + 100, row.y + 15, 160);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await open();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.waitForTimeout(320);
  await drag(90, 195, 120, true);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const field = (await page.getByLabel('Home city', { exact: true }).boundingBox())!;
  await drag(field.x + 30, field.y + 20, 180);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await drag(90, 195, 210);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await open();
  await page.getByRole('button', { name: 'Connected apps', exact: true }).click();
  await page.waitForTimeout(320);
  const screen = page.locator('.wd-settings-page:not([inert]) .wd-you');
  await drag(25, 650, -260);
  await expect.poll(() => screen.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await drag(25, 250, 80);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const header = (await screen.locator('.wd-taskbar').boundingBox())!;
  await drag(280, header.y + 20, 210);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await input.detach();
});

test('keyboard focus on the Settings container preserves rounded corners without a panel outline',async({page})=>{
 await page.goto('/?uiPreview=1');
 const open=page.getByRole('button',{name:'You',exact:true});
 await open.focus(); await open.press('Enter');
 const sheet=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(sheet).toBeFocused();
 expect(await sheet.evaluate(element => element.matches(':focus-visible'))).toBe(true);
 await expect(sheet).toHaveCSS('border-top-left-radius','28px');
 await expect(sheet).toHaveCSS('border-top-right-radius','28px');
 await expect(sheet).toHaveCSS('outline-style','none');
 const close=sheet.getByRole('button',{name:'Close Settings',exact:true});
 await close.focus();
 await expect(close).toHaveCSS('outline-style','solid');
 await expect(close).toHaveCSS('outline-width','2px');
 await expect(close).toHaveCSS('border-top-left-radius','22px');
});
