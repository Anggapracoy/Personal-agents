import { test, expect } from '@playwright/test';

test('native Home controls wait for acknowledgement and keep search/archive/back actions', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__decisionFeedNativeHomeHeader = true;
    w.headerMessages = [];
    w.webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => {
      if (message.action === 'homeHeaderState') w.headerMessages.push(message.payload);
    } } } };
  });
  await page.goto('/?uiPreview=1');
  const latest = () => page.evaluate(() => (window as any).headerMessages.filter((m: any) => !m.hidden).at(-1));
  await expect.poll(async () => (await latest())?.buttons?.length).toBe(2);
  const home = page.locator('.wd-home').first();
  await expect(home.locator('[data-home-action="search"]')).toBeVisible();
  const first = await latest();
  const action = async (id: string, action: string) => page.evaluate(({ id, action }) => {
    window.dispatchEvent(new CustomEvent('decisionFeed:homeHeaderAction', { detail: { id, action } }));
  }, { id, action });
  await action('stale-id', 'ready');
  await expect(home.locator('[data-home-action="search"]')).toBeVisible();
  await action(first.id, 'ready');
  await expect(home.locator('[data-home-action="search"]')).toBeHidden();
  await action(first.id, 'search');
  await expect(home.getByRole('searchbox')).toBeFocused();
  await expect.poll(async () => (await latest())?.searching).toBe(true);
  await action(first.id, 'search');
  await expect(home.locator('input.wd-home-search')).toBeDisabled();
  await action(first.id, 'archive');
  await expect.poll(async () => (await latest())?.archived).toBe(true);
  const archive = await latest();
  expect(archive.buttons.map((b: any) => b.action)).toEqual(['back', 'search']);
  await action(archive.id, 'ready');
  await action(archive.id, 'back');
  await expect.poll(async () => (await latest())?.archived).toBe(false);
  await action(first.id, 'search');
  await expect(home.getByRole('searchbox')).toBeFocused();
});

test('native Home buttons follow a late safe-area inset without opening settings', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__decisionFeedNativeHomeHeader = true;
    w.headerMessages = [];
    w.webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: any) => {
      if (message.action === 'homeHeaderState' && !message.payload.hidden) w.headerMessages.push(message.payload);
    } } } };
  });
  await page.goto('/?uiPreview=1');
  const home = page.locator('.wd-home').first();
  const latestY = () => page.evaluate(() => (window as any).headerMessages.at(-1)?.buttons.find((b: any) => b.action === 'search')?.y);
  await expect.poll(latestY).toBeGreaterThan(0);
  const headerSize = await home.locator('header').boundingBox();
  const before = await latestY();
  await home.evaluate(el => (el as HTMLElement).style.setProperty('--safe-top', '62px'));
  const buttonY = (await home.locator('[data-home-action="search"]').boundingBox())!.y;
  expect(buttonY).toBeGreaterThan(before + 40);
  expect((await home.locator('header').boundingBox())!.height).toBe(headerSize!.height);
  await expect.poll(latestY).toBe(buttonY);
});

test('Settings retains feed header and composer identities behind its tracked bounds',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;
  w.__decisionFeedNativeHomeHeader=true;w.__decisionFeedNativeComposer=true;
  w.chromeMessages=[];
  w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>w.chromeMessages.push(message)}}};
 });
 await page.goto('/?uiPreview=1');
 await expect.poll(()=>page.evaluate(()=>(window as any).chromeMessages.some((m:any)=>m.action==='homeHeaderState'&&!m.payload.hidden))).toBe(true);
 const before=await page.evaluate(()=>(window as any).chromeMessages.filter((m:any)=>['homeHeaderState','composerState'].includes(m.action)&&!m.payload.hidden).map((m:any)=>({action:m.action,id:m.payload.id})));
 await page.evaluate(()=>(window as any).chromeMessages=[]);
 await page.getByRole('button',{name:'You',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).chromeMessages.some((m:any)=>m.action==='modalOverlayVisibility'&&m.payload.visible&&m.payload.keepsBackgroundChrome))).toBe(true);
 const hidden=await page.evaluate(()=>(window as any).chromeMessages.filter((m:any)=>(m.action==='homeHeaderState'&&m.payload.hidden)||m.action==='composerHide'));
 expect(hidden).toEqual([]);
 expect(before.some((m:{action:string;id:string})=>m.action==='composerState')).toBe(true);
 await page.getByRole('button',{name:'Close Settings',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toHaveCount(0);
 const after=await page.evaluate(()=>(window as any).chromeMessages.filter((m:any)=>['homeHeaderState','composerState'].includes(m.action)&&!m.payload.hidden).map((m:any)=>({action:m.action,id:m.payload.id})));
 expect(after.every((m:{action:string;id:string})=>before.some((b:{action:string;id:string})=>b.action===m.action&&b.id===m.id))).toBe(true);
});

test('native profile button matches the other header bounds and opens Settings',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.__decisionFeedNativeHomeHeader=true;w.__decisionFeedNativeHomeAvatar=true;w.profileHeaders=[];
  w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(m:any)=>{if(m.action==='homeHeaderState'&&!m.payload.hidden)w.profileHeaders.push(m.payload)}}}};
 });
 await page.goto('/?uiPreview=1');
 await expect.poll(()=>page.evaluate(()=>(window as any).profileHeaders.at(-1)?.buttons.length)).toBe(3);
 const header=await page.evaluate(()=>(window as any).profileHeaders.at(-1));
 expect(header.buttons.map((b:any)=>[b.width,b.height])).toEqual([[44,44],[44,44],[44,44]]);
 expect(header.avatarInitial).toBeTruthy();
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('decisionFeed:homeHeaderAction',{detail:{id,action:'ready'}})),header.id);
 await expect(page.locator('[data-home-profile]')).toBeHidden();
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('decisionFeed:homeHeaderAction',{detail:{id,action:'you'}})),header.id);
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
});

test('browser sheet preserves uncovered native chat chrome and clears coverage on close',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.__decisionFeedNativeChatHeader=true;w.chromeMessages=[];
  w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>w.chromeMessages.push(message)}}};
 });
 await page.goto('/?uiPreview=1&task=preview-live-task');
 await expect.poll(()=>page.evaluate(()=>(window as any).chromeMessages.some((m:any)=>m.action==='chatHeaderState'))).toBe(true);
 await page.evaluate(()=>(window as any).chromeMessages=[]);
 await page.getByRole('button',{name:'Open browser',exact:true}).click();
 await expect(page.locator('.cloud-browser-panel')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).chromeMessages.filter((m:any)=>m.action==='modalOverlayVisibility').at(-1)?.payload.keepsBackgroundChrome)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).chromeMessages.filter((m:any)=>m.action==='browserViewerVisibility').at(-1)?.payload.visible)).toBe(true);
 expect(await page.evaluate(()=>(window as any).chromeMessages.some((m:any)=>m.action==='chatHeaderHide'))).toBe(false);
 await page.locator('.cloud-browser-panel').getByRole('button',{name:'Hide browser',exact:true}).click();
 await expect(page.locator('.cloud-browser-panel')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).chromeMessages.filter((m:any)=>m.action==='modalOverlayVisibility').at(-1)?.payload.visible)).toBe(false);
});

test('Settings confirmation hides native chrome and restores parent coverage after dismissal',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.chromeMessages=[];w.__decisionFeedNativeHomeHeader=true;w.__decisionFeedNativeBrowserClose=true;
  w.webkit={messageHandlers:{decisionFeedNative:{postMessage:(m:any)=>w.chromeMessages.push(m)}}};
 });
 await page.goto('/?uiPreview=1');
 await page.getByRole('button',{name:'You',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(settings).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
 const latest=(action:string)=>page.evaluate(action=>(window as any).chromeMessages.filter((m:any)=>m.action===action).at(-1)?.payload,action);
 const parent=await latest('sheetCoverage'),close=await latest('browserCloseState');
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('decisionFeed:browserCloseAction',{detail:{id,action:'ready'}})),close.id);
 await page.evaluate(()=>(window as any).chromeMessages=[]);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'Sign out of Dash?',exact:true});
 await expect(confirmation).toBeVisible();
 await expect(confirmation).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(confirmation.getByRole('button',{name:'Sign out',exact:true})).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 await expect(confirmation.getByRole('button',{name:'Stay signed in',exact:true})).toBeFocused();
 await expect.poll(async()=>(await latest('modalOverlayVisibility'))?.keepsBackgroundChrome).toBe(false);
 await expect.poll(async()=>(await latest('browserCloseState'))?.opacity).toBe(0);
 await expect.poll(async()=>(await latest('sheetCoverage'))?.dimming).toBeGreaterThan(parent.dimming);
 const nested=await latest('sheetCoverage');expect(nested.y).toBeCloseTo(parent.y,0);expect(nested.headerOpacity).toBe(0);
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('decisionFeed:browserCloseAction',{detail:{id,action:'close'}})),close.id);
 await expect(settings).toBeVisible();await expect(confirmation).toBeVisible();
 await page.screenshot({path:'/tmp/dash-settings-confirmation-web.png'});
 await confirmation.getByRole('button',{name:'Stay signed in',exact:true}).click();
 await expect(confirmation).toHaveCount(0);
 await expect.poll(async()=>(await latest('sheetCoverage'))?.headerOpacity).toBe(0);
 const restored=await latest('sheetCoverage');expect(restored.y).toBeCloseTo(parent.y,0);expect(restored.height).toBeCloseTo(parent.height,0);
 await expect.poll(async()=>(await latest('browserCloseState'))?.opacity).toBe(1);
 await expect.poll(async()=>(await latest('modalOverlayVisibility'))?.keepsBackgroundChrome).toBe(true);
 expect(await page.evaluate(()=>(window as any).chromeMessages.some((m:any)=>m.action==='sheetCoverage'&&m.payload.ended))).toBe(false);
 await page.screenshot({path:'/tmp/dash-settings-restored-web.png'});
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('decisionFeed:browserCloseAction',{detail:{id,action:'close'}})),close.id);
 await expect(settings).toHaveCount(0);
 await expect.poll(async()=>(await latest('sheetCoverage'))?.ended).toBe(true);
});
