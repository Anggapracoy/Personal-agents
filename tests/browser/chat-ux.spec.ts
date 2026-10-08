import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('incoming typing moves a pinned transcript continuously and yields to touch', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 520 });
  await page.goto('/?uiPreview=1&sendMotionPreview=reply&task=preview-messages-polish');
  await page.getByPlaceholder('Reply…').fill('Heyyy');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => {
    const row = document.querySelector('.wd-front-layer .wd-user-turn');
    return Boolean(document.querySelector('.wd-typing') && row?.getAnimations().some(a => a.playState === 'running'));
  });
  await page.locator('.wd-front-layer .wd-task').dispatchEvent('pointerdown');
  expect(await page.locator('.wd-front-layer .wd-user-turn').first().evaluate(row => row.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  await expect(page.locator('.wd-front-layer .wd-thread')).toContainText('Heyyy yourself.');
  await expect(page.locator('.wd-typing')).toHaveCount(0);
});

test('proactive avatar opens its conversation without choosing an action', async ({ page }) => {
  await page.goto('/?uiPreview=1');
  const row = page.locator('.wd-proactive-item').first();
  const title = await row.locator('h2').innerText();
  await row.locator('.wd-proactive-avatar').click();
  await expect(page.locator('.wd-front-layer .wd-taskbar-title')).toContainText(title);
  await expect(page.locator('.wd-front-layer .wd-ask-actions')).toBeVisible();
});

test('Home acknowledgement keeps its timestamp through every intermediate render', async ({ page }) => {
  await page.goto('/?uiPreview=1&sendMotionPreview=1');
  await page.getByPlaceholder('Message Dash…').fill('Timestamp handoff check');
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as any).homeTimestampSamples = samples;
    const until = performance.now() + 2500;
    const sample = () => {
      const thread = document.querySelector('.wd-front-layer .wd-thread');
      if (thread?.querySelector('.wd-user-turn')) samples.push(thread.querySelectorAll('.wd-message-time').length);
      if (performance.now() < until) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.wd-front-layer .wd-message-receipt')).toContainText('Read');
  const samples = await page.evaluate(() => (window as any).homeTimestampSamples as number[]);
  expect(samples.length).toBeGreaterThan(5);
  expect(samples.every(count => count === 1), 'No intermediate sent fallback may collapse the timestamp row').toBe(true);
});

for (const native of [false, true]) {
  test(`sent bubble stays painted during flight (${native ? 'native' : 'web'} composer)`, async ({ page }) => {
    await page.setContent(`<div class="wd"><div class="wd-front-layer"><div class="wd-task"><div class="wd-thread"></div></div></div><form class="wd-composer ${native ? 'is-native' : ''}"><textarea>Hello there</textarea></form></div>`);
    await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
    await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
    await page.addStyleTag({ content: '.wd-task{position:absolute;inset:0;padding:40px 20px}.wd-composer{position:absolute;bottom:30px}.wd-bubble{position:relative}' });
    const source = ts.transpileModule(readFileSync('app/message-send-motion.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    await page.addScriptTag({ type: 'module', content: source + '\nwindow.sendMotion = {prepareMessageSend, animateMessageSend};' });
    await page.waitForFunction(() => Boolean((window as any).sendMotion));
    const flight = await page.evaluate((native) => {
      const api = (window as any).sendMotion;
      api.prepareMessageSend(document.querySelector('form'), 'Hello there', native ? { x: 80, y: 730, width: 220, height: 24 } : undefined);
      document.querySelector('.wd-thread')!.innerHTML = '<div class="wd-user-turn" data-message-id="new"><div class="wd-bubble is-me">Hello there</div></div>';
      // Hold the actual animation at its middle, after the draft text fades.
      window.requestAnimationFrame = () => 1;
      api.animateMessageSend(document.querySelector('.wd-task'));
      document.getAnimations().forEach(animation => { animation.currentTime = 220; });
      const surface = getComputedStyle(document.querySelector('.wd-send-surface')!);
      const destination = getComputedStyle(document.querySelector('.wd-send-destination')!);
      return { background: surface.backgroundImage, color: surface.backgroundColor, textOpacity: destination.opacity, hidden: getComputedStyle(document.querySelector('.wd-thread .wd-bubble')!).visibility };
    }, native);
    expect(flight.hidden).toBe('hidden');
    expect(flight.textOpacity).toBe('1');
    expect(flight.background, 'white sent text needs its blue surface throughout the flight').toContain('linear-gradient');
    await page.screenshot({ path: `/tmp/dash-send-${native ? 'native' : 'web'}.png` });
    await page.locator('.wd').dispatchEvent('pointerdown');
    await expect(page.locator('.wd-send-flight')).toHaveCount(0);
    await expect(page.locator('.wd-thread .wd-bubble')).toBeVisible();
  });
}

test('Home send keeps the destination hidden until the bubble lands at the top', async ({ page }) => {
  await page.setContent('<div class="wd" style="position:relative;width:390px;height:844px"><div class="wd-home-layer"><form class="wd-composer is-home is-native"><textarea>Hi</textarea></form></div></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  const source = ts.transpileModule(readFileSync('app/message-send-motion.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  await page.addScriptTag({ type: 'module', content: source + '\nwindow.sendMotion = {prepareMessageSend, animateMessageSend};' });
  await page.waitForFunction(() => Boolean((window as any).sendMotion));
  const before = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.wd')!;
    (window as any).sendMotion.prepareMessageSend(root.querySelector('form'), 'Hi', { x: 100, y: 735, width: 240, height: 22 });
    root.insertAdjacentHTML('beforeend', '<div class="wd-front-layer"><div class="wd-task" style="position:absolute;inset:0;padding:120px 20px 100px"><div class="wd-thread"><time class="wd-message-time">Today 9:41 AM</time><div class="wd-user-turn" data-message-id="new"><div class="wd-bubble is-me">Hi</div></div><div></div></div></div></div>');
    const turn = root.querySelector<HTMLElement>('.wd-user-turn')!;
    const time = root.querySelector<HTMLElement>('.wd-message-time')!;
    return { turn: getComputedStyle(turn).visibility, time: getComputedStyle(time).opacity };
  });
  expect(before).toEqual({ turn: 'hidden', time: '0' });
  await page.evaluate(() => {
    (window as any).sendMotion.animateMessageSend(document.querySelector('.wd-task'));
  });
  await expect(page.locator('.wd-send-flight')).toBeVisible();
  await expect(page.locator('.wd-send-flight')).toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator('.wd-message-time')).toHaveCSS('opacity', '1');
  const after = await page.evaluate(() => {
    const turn = document.querySelector<HTMLElement>('.wd-user-turn')!;
    const time = document.querySelector<HTMLElement>('.wd-message-time')!;
    return { turn: getComputedStyle(turn).visibility, time: getComputedStyle(time).opacity, bubbleTop: turn.getBoundingClientRect().top };
  });
  expect(after.turn).toBe('visible');
  expect(after.time).toBe('1');
  expect(after.bubbleTop).toBeLessThan(400);
});

test('native flight owns the bubble a grouped second send through its completion acknowledgement', async ({ page }) => {
  await page.setContent('<div class="wd"><form class="wd-composer is-native"><textarea>Heyyy</textarea></form><div class="wd-front-layer"><div class="wd-task"><div class="wd-thread"><div class="wd-user-turn" data-message-id="earlier"><div class="wd-bubble is-me">Earlier</div><span class="wd-message-receipt">Read</span></div></div></div></div></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') + readFileSync('app/wdyt.css', 'utf8') });
  const source = ts.transpileModule(readFileSync('app/message-send-motion.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  await page.addScriptTag({ type: 'module', content: source + '\nwindow.sendMotion = {prepareMessageSend, animateMessageSend};' });
  await page.waitForFunction(() => Boolean((window as any).sendMotion));
  await expect.poll(() => page.locator('.wd-user-turn').evaluate(node => getComputedStyle(node).paddingBottom)).toBe('20px');
  const payload = await page.evaluate(() => {
    const sent: any[] = [];
    (window as any).nativeFlightEvents = sent;
    (window as any).webkit = { messageHandlers: { decisionFeedNative: {postMessage: (message: any) => sent.push(message)} } };
    const api = (window as any).sendMotion;
    api.prepareMessageSend(document.querySelector('form'), 'Heyyy', { x: 88, y: 500, width: 242, height: 22, nativeFlight: true });
    document.querySelector('.wd-user-turn')!.classList.add('has-following');
    document.querySelector('.wd-thread')!.insertAdjacentHTML('beforeend', '<div class="wd-user-turn is-grouped" data-message-id="outgoing"><div class="wd-bubble is-me">Heyyy</div></div>');
    api.animateMessageSend(document.querySelector('.wd-task'));
    return sent.find(message => message.action === 'messageSendFlight').payload;
  });
  expect(payload.id).toBe('outgoing');
  expect(payload.width).toBeGreaterThan(0);
  expect(payload.samples[0]).toEqual([0, 0, 1]);
  await expect(page.locator('[data-message-id=outgoing] .wd-bubble')).toBeHidden();
  await expect(page.locator('.wd-send-flight')).toBeHidden();
  // Let the old receipt's former transition interval elapse. The native
  // target must still coincide with the actual DOM landing rectangle.
  await page.waitForTimeout(220);
  const landing = await page.locator('[data-message-id=outgoing] .wd-bubble').boundingBox();
  expect(landing!.y).toBeCloseTo(payload.y, 1);
  const cancelledBeforePaint = await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('decisionFeed:sendFlightFinished', {detail: {id: 'outgoing'}}));
    return (window as any).nativeFlightEvents.some((event: any) => event.payload.cancel);
  });
  expect(cancelledBeforePaint).toBe(false);
  await expect(page.locator('[data-message-id=outgoing] .wd-bubble')).toBeVisible();
  await expect(page.locator('.wd-send-flight')).toHaveCount(0);
  await page.waitForFunction(() => (window as any).nativeFlightEvents.some((event: any) => event.payload.cancel));
});

test('receipt handoff closes the old slot smoothly without moving the timestamp', async ({ page }) => {
  await page.setContent('<div class="wd"><div class="wd-task"><div class="wd-thread"><time class="wd-message-time">Today 8:23 AM</time><div class="wd-user-turn"><div class="wd-bubble is-me">Earlier message</div><span class="wd-message-receipt is-previous">Read 8:22 AM</span></div><div class="wd-agent">Reply</div><div class="wd-user-turn"><div class="wd-bubble is-me">Heyyy</div><span class="wd-message-receipt">Sending…</span></div></div></div></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') + readFileSync('app/wdyt.css', 'utf8') });
  const positions = () => page.locator('.wd-message-time, .wd-thread .wd-bubble, .wd-thread .wd-agent').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  await expect.poll(() => page.locator('.wd-user-turn').first().evaluate(node => getComputedStyle(node).paddingBottom)).toBe('20px');
  const before = await positions();
  await page.evaluate(() => {
    document.querySelector('.wd-message-receipt.is-previous')!.remove();
    document.querySelector('.wd-message-receipt')!.textContent = 'Delivered';
  });
  const during = await positions();
  expect(during[0]).toBe(before[0]);
  expect(during[3]).toBeGreaterThan(before[3] - 20);
  await expect.poll(async () => (await positions())[3]).toBeCloseTo(before[3] - 20, 1);
  expect((await positions())[0]).toBe(before[0]);
});

test('older outgoing messages leave no empty receipt slot', async ({ page }) => {
  await page.setContent('<div class="wd"><div class="wd-task"><div class="wd-thread"><div class="wd-user-turn"><div class="wd-bubble is-me">Heyyy</div></div><div class="wd-user-turn"><div class="wd-bubble is-me">Heyyy</div><span class="wd-message-receipt">Delivered</span></div></div></div></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') + readFileSync('app/wdyt.css', 'utf8') });
  const gap = () => page.locator('.wd-bubble').evaluateAll(nodes => nodes[1].getBoundingClientRect().top - nodes[0].getBoundingClientRect().bottom);
  expect(await gap()).toBe(10);
  await page.locator('.wd-user-turn').first().evaluate(node => node.classList.add('has-following'));
  await page.locator('.wd-user-turn').last().evaluate(node => node.classList.add('is-grouped'));
  expect(await gap()).toBe(4);
});

test('wrapped text fits its longest line without changing line count or rich content width', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.setContent('<div class="wd"><div class="wd-task" style="width:402px;padding:16px"><div class="wd-thread"><div class="wd-reactable"><div class="wd-agent" id="plain">Heyyy yourself. I’m right here, what do you need?</div><button class="wd-react-trigger">Actions</button></div><div class="wd-reactable"><div class="wd-agent" id="rich"><a class="wd-link-preview">A link preview</a></div></div></div></div></div>');
  await page.addStyleTag({ content: readFileSync('app/brand-tokens.css', 'utf8') + readFileSync('app/wdyt.css', 'utf8') });
  const source = ts.transpileModule(readFileSync('app/message-text-layout.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  await page.addScriptTag({ type: 'module', content: source + '\nwindow.fitMessageText = fitMessageText;' });
  await page.waitForFunction(() => Boolean((window as any).fitMessageText));
  const sizes = () => page.evaluate(() => Object.fromEntries(['plain', 'rich'].map(id => {
    const node = document.getElementById(id)!;
    return [id, { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }];
  })));
  const before = await sizes();
  await page.evaluate(() => (window as any).fitMessageText(document.querySelector('.wd-task')));
  const after = await sizes();
  expect(after.plain.width).toBeLessThan(before.plain.width - 5);
  expect(after.plain.height).toBe(before.plain.height);
  expect(after.rich).toEqual(before.rich);
  await page.screenshot({ path: '/tmp/dash-wrapped-text-browser.png' });
  await page.setViewportSize({ width: 900, height: 874 });
  await page.evaluate(() => (window as any).fitMessageText(document.querySelector('.wd-task')));
  expect(await page.locator('#plain').evaluate(node => (node as HTMLElement).style.width)).toBe('');
});

test('new receipt expands only after the outgoing flight has landed', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto('/?uiPreview=1&sendMotionPreview=1&task=preview-send-reference');
  await page.getByPlaceholder('Reply…').fill('Heyyy');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const turn = page.locator('.wd-front-layer .wd-user-turn').last();
  await expect(turn.locator('.wd-message-receipt')).toHaveClass(/is-pending/);
  expect(await turn.evaluate(node => getComputedStyle(node).paddingBottom)).toBe('0px');
  await expect(turn.locator('.wd-message-receipt')).not.toHaveClass(/is-pending/);
  expect(await page.locator('.wd').evaluate(node => node.hasAttribute('data-sending-message'))).toBe(false);
  await expect.poll(() => turn.evaluate(node => getComputedStyle(node).paddingBottom)).toBe('20px');
  await page.screenshot({ path: '/tmp/dash-receipt-after-flight.png' });
});

for (const caption of ['', 'My photo']) test(`Home photo send is visible immediately and settles with caption=${Boolean(caption)}`, async ({ page }) => {
  await page.setContent('<div class="wd" style="position:relative;width:390px;height:844px"><form class="wd-composer is-home"><textarea></textarea></form></div>');
  await page.addStyleTag({ content: readFileSync('app/wdyt.css', 'utf8') });
  const source = ts.transpileModule(readFileSync('app/message-send-motion.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  await page.addScriptTag({ type:'module', content:source+'\nwindow.sendMotion = {prepareMessageSend, animateMessageSend};' });
  await page.waitForFunction(() => Boolean((window as any).sendMotion));
  await page.evaluate(caption => {
    const root = document.querySelector<HTMLElement>('.wd')!;
    (window as any).sendMotion.prepareMessageSend(root.querySelector('form'), caption || 'Shared an attachment', {x:100,y:730,width:240,height:22});
    root.insertAdjacentHTML('beforeend', '<div class="wd-front-layer"><div class="wd-task"><div class="wd-thread"><div class="wd-user-turn" data-message-id="photo"><div class="wd-photo-message" style="width:200px;height:220px;background:#cf8060">Photo</div></div></div></div></div>');
    if (caption) {
      const text = document.createElement('div'); text.className='wd-bubble is-me'; text.textContent=caption;
      root.querySelector('.wd-user-turn')!.append(text);
    }
    (window as any).sendMotion.animateMessageSend(root.querySelector('.wd-task'));
  }, caption);
  await expect(page.locator('.wd-photo-message')).toBeVisible();
  expect(await page.locator('.wd-user-turn').evaluate(node => node.getAnimations().length)).toBe(1);
  await expect.poll(() => page.locator('.wd').evaluate(node => node.hasAttribute('data-sending-message'))).toBe(false);
  await expect(page.locator('.wd-photo-message')).toBeVisible();
  await expect(page.locator('.wd-user-turn')).toHaveCSS('transform','none');
});
