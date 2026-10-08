import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { VISUAL_CURSOR_EXPRESSION, CURSOR_RESTORE_EXPRESSION, CURSOR_FRAME_POINT } from '../../lib/harness/browser/visual-cursor';
import { CLOUD_BROWSER_CONTROLLER } from '../../lib/harness/browser/cloud-controller';

const extracted = spawnSync('python3', ['-c', "import sys,json\nns={'__name__':'test'}\nexec(sys.stdin.read(),ns)\nprint(json.dumps(ns['SNAPSHOT_EXPRESSION'].replace('__REF_START__','0')))"], {input:CLOUD_BROWSER_CONTROLLER,encoding:'utf8'});
if (extracted.status !== 0) throw new Error(extracted.stderr);
const snapshotScript = JSON.parse(extracted.stdout) as string;
const event = (kind:string, x=0, y=0) => `(${VISUAL_CURSOR_EXPRESSION})(${JSON.stringify({kind,x,y})})`;

test.beforeEach(async ({page}) => {
  // Keep a test-only reference to the CLOSED root without changing its mode.
  await page.evaluate(() => {
    const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(init) {
      const root=attach.call(this,init);
      if(this.id==='dash-visual-cursor') (window as any).__cursorTestRoot=root;
      return root;
    };
  });
  await page.setContent('<style>body{margin:0;font:17px system-ui}button{position:absolute;left:190px;top:270px;width:140px;height:55px}input{position:absolute;top:100px}</style><input aria-label="Card test"><button>Continue</button>');
});

test('glides, retargets without jumping, pulses, and never intercepts input or changes observations', async ({page}) => {
  const layout=await page.locator('button').boundingBox();
  await page.locator('input').focus();
  await page.evaluate(snapshotScript);
  const before=await page.evaluate(snapshotScript);
  await page.evaluate(event('move',30,50));
  await page.evaluate(event('move',260,297));
  await page.waitForTimeout(80);
  const point=()=>page.evaluate(() => {const m=new DOMMatrix(getComputedStyle((window as any).__cursorTestRoot.querySelector('.position')).transform);return {x:m.m41,y:m.m42};});
  const during=await point();
  expect(during.x).toBeGreaterThan(30); expect(during.x).toBeLessThan(260);
  await page.evaluate(event('move',190,250));
  expect(Math.abs((await point()).x-during.x)).toBeLessThan(35);
  await expect.poll(async () => (await point()).x, { timeout: 3000 }).toBeCloseTo(190, 0);
  await expect(page.locator('input')).toBeFocused();
  expect(await page.locator('button').boundingBox()).toEqual(layout);
  expect(await page.evaluate(snapshotScript)).toEqual(before);
  expect(await page.locator('#dash-visual-cursor').evaluate(e=>e.shadowRoot)).toBeNull();
  await page.evaluate(event('move',260,297));
  await page.evaluate(() => { (window as any).clicks=0; document.querySelector('button')!.onclick=()=>{(window as any).clicks++;}; });
  await page.mouse.click(260,297);
  await page.evaluate(event('click'));
  await expect.poll(()=>page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.ring').getAnimations().length), {intervals:[20]}).toBe(1);
  expect(await page.evaluate(()=> (window as any).clicks)).toBe(1);
  expect(await page.evaluate(()=>document.elementFromPoint(260,297)?.tagName)).toBe('BUTTON');
  await page.evaluate(event('hide'));
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.position').style.opacity)).toBe('0');
});

test('frame geometry includes borders and scaling and pointer does not steal hosted-field focus', async ({page}) => {
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.style.cssText='position:absolute;left:20px;top:350px;width:250px;height:100px;border:4px solid;transform:scale(.8);transform-origin:top left';frame.srcdoc='<input aria-label="CVC" style="margin:0;width:100px">';document.body.append(frame);});
  const frame=page.frameLocator('iframe');
  await frame.getByRole('textbox').focus();
  const mapped=await page.evaluate<{x:number;y:number}>(`(${CURSOR_FRAME_POINT}).call(document.querySelector('iframe'),{x:50,y:30})`);
  expect(mapped.x).toBeCloseTo(63.2,3); expect(mapped.y).toBeCloseTo(377.2,3);
  await page.evaluate(event('move',mapped.x,mapped.y));
  await frame.getByRole('textbox').fill('123');
  await expect(frame.getByRole('textbox')).toHaveValue('123');
  await expect(frame.getByRole('textbox')).toBeFocused();
  await page.evaluate(()=>{document.body.style.zoom='1.25';});
  const zoomed=await page.evaluate<{x:number;y:number}>(`(${CURSOR_FRAME_POINT}).call(document.querySelector('iframe'),{x:50,y:30})`);
  expect(zoomed.x).toBeCloseTo(mapped.x*1.25,0);
});

test('reduced motion, scrolling, explicit removal and a new document preserve cursor behavior', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(event('move',10,10));
  await page.evaluate(event('move',200,300));
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.position').style.transform)).toBe('translate3d(200px, 300px, 0px)');
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.position').style.opacity)).toBe('1');
  await page.locator('#dash-visual-cursor').evaluate(e=>e.remove());
  await page.evaluate(event('move',100,100));
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
  await page.goto('about:blank');
  await page.evaluate(event('click'));
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(0);
  await page.evaluate(event('move',50,50));
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
});

test('uses every avatar colour and updates an existing cursor without replacing it', async ({page}) => {
  const { CHARACTERS } = await import('../../lib/conversation-character');
  for (const character of CHARACTERS) {
    await page.evaluate(`(${VISUAL_CURSOR_EXPRESSION})(${JSON.stringify({kind:'move',x:80,y:80,color:character.color})})`);
    const colors = await page.evaluate(() => {
      const root = (window as any).__cursorTestRoot;
      return {halo:getComputedStyle(root.querySelector('.halo path')).fill,ring:getComputedStyle(root.querySelector('.ring')).borderColor};
    });
    const rgb = [1,3,5].map(i => parseInt(character.color.slice(i,i+2),16)).join(', ');
    expect(colors.halo).toContain(rgb);
    expect(colors.ring).toContain(rgb);
    await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
  }
});


test('idle waits and screenshots never fade the cursor or drop a delayed click', async ({page}) => {
  await page.evaluate(event('move',100,100));
  await page.waitForTimeout(2200);
  const opacity = () => page.evaluate(() => getComputedStyle((window as any).__cursorTestRoot.querySelector('.position')).opacity);
  expect(await opacity()).toBe('1');
  await page.screenshot();
  expect(await opacity()).toBe('1');
  await page.evaluate(event('click'));
  expect(await page.evaluate(() => (window as any).__cursorTestRoot.querySelector('.ring').getAnimations().length)).toBe(1);
  await page.waitForTimeout(450);
  expect(await opacity()).toBe('1');
});

test('signature travel settles exactly and click ripple starts immediately at its destination', async ({page}) => {
  await page.clock.install();
  await page.evaluate(event('move',20,30));
  await page.evaluate(event('move',350,700));
  await page.evaluate(event('click'));
  const ripple = await page.evaluate(() => {
    const ring = (window as any).__cursorTestRoot.querySelector('.ring');
    return {left:ring.style.left,top:ring.style.top,animations:ring.getAnimations().length};
  });
  expect(ripple).toEqual({left:'335px',top:'685px',animations:1});
  await page.clock.runFor(1100);
  const point = await page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle((window as any).__cursorTestRoot.querySelector('.position')).transform);
    return {x:m.m41,y:m.m42};
  });
  expect(Math.hypot(point.x-350,point.y-700)).toBeLessThan(1);
});


test('restores the visible cursor across cross-site navigation but never after hiding', async ({page}) => {
  await page.route('https://cursor-one.test/**', route => route.fulfill({body:'<button>First</button>'}));
  await page.route('https://cursor-two.test/**', route => route.fulfill({body:'<button>Second</button><iframe src="https://cursor-one.test/frame"></iframe>'}));
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  const source=`(${CURSOR_RESTORE_EXPRESSION})({kind:'move',x:200,y:100,color:'#B387DD'})`;
  const {identifier}=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source,worldName:'dash-visual-cursor'});
  await page.goto('https://cursor-one.test/');
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
  await page.goto('https://cursor-two.test/');
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
  await expect(page.frameLocator('iframe').locator('#dash-visual-cursor')).toHaveCount(0);
  const {frameTree}=await cdp.send('Page.getFrameTree');
  const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'dash-visual-cursor'});
  // Next motion reuses the restored instance, starting at its retained position.
  await cdp.send('Runtime.evaluate',{contextId:executionContextId,expression:`(${VISUAL_CURSOR_EXPRESSION})({kind:'move',x:300,y:200})`});
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  await page.locator('#dash-visual-cursor').evaluate(e=>e.remove());
  await page.goto('https://cursor-one.test/again');
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(0);
});


test('page layout events do not hide the stationary cursor', async ({page}) => {
  await page.evaluate(event('move',200,100));
  await page.evaluate(() => {window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('scroll'));});
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.position').style.opacity)).toBe('1');
});


test('replaces stale artwork on the next move without resurrecting a hidden cursor', async ({page}) => {
  await page.evaluate(event('move',80,100));
  await page.evaluate(() => {
    const old = (window as any).__dashVisualCursor;
    old.revision = 'old-thin-outline';
    (window as any).__oldCursorHost = old.host;
  });
  await page.evaluate(event('move',160,180));
  expect(await page.evaluate(() => (window as any).__oldCursorHost.isConnected)).toBe(false);
  expect(await page.evaluate(() => (window as any).__cursorTestRoot.querySelector('.arrow path').getAttribute('stroke-width'))).toBe('6.8');
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
  await page.evaluate(() => { (window as any).__dashVisualCursor.revision = undefined; });
  await page.evaluate(event('hide'));
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(0);
  await page.evaluate(event('click'));
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(0);
  await page.evaluate(event('move',160,180));
  await expect(page.locator('#dash-visual-cursor')).toHaveCount(1);
});

test('idle rocking keeps the target fixed and cancels for movement, hiding and reduced motion', async ({page}) => {
  await page.evaluate(event('move',150,160));
  const idle = () => page.evaluate(() => (window as any).__cursorTestRoot.querySelector('.sway').classList.contains('idle'));
  await expect.poll(idle).toBe(true);
  expect(await page.evaluate(() => { const s = getComputedStyle((window as any).__cursorTestRoot.querySelector('.sway')); return [s.transformOrigin, s.animationDuration]; })).toEqual(['14.2px 15.6px', '1.8s']);
  expect(await page.evaluate(() => (window as any).__cursorTestRoot.querySelector('.position').style.transform)).toBe('translate3d(150px, 160px, 0px)');
  expect(await page.evaluate(() => (window as any).__cursorTestRoot.querySelector('.sway').getAnimations().length)).toBe(1);
  await page.evaluate(event('move',240,220));
  expect(await idle()).toBe(false);
  await page.evaluate(event('hide'));
  await page.waitForTimeout(800);
  expect(await idle()).toBe(false);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(event('move',150,160));
  await page.waitForTimeout(800);
  expect(await idle()).toBe(false);
});

test('strict page CSP cannot strip cursor sizing and expand it over the page', async ({page}) => {
  await page.route('https://cursor.test/', route => route.fulfill({
    contentType:'text/html', headers:{'Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'none'"},
    body:'<!doctype html><html><body>Checkout</body></html>',
  }));
  await page.goto('https://cursor.test/');
  await page.evaluate(()=>{
    const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(init){const root=attach.call(this,init);if(this.id==='dash-visual-cursor')(window as any).__cursorTestRoot=root;return root;};
  });
  await page.evaluate(event('move',200,250));
  const dimensions=await page.evaluate(()=>{
    const root=(window as any).__cursorTestRoot;const arrow=root.querySelector('.arrow');const rect=arrow.getBoundingClientRect();
    return{width:rect.width,height:rect.height,position:getComputedStyle(root.querySelector('.position')).position};
  });
  expect(dimensions.width).toBeCloseTo(36,0);expect(dimensions.height).toBeCloseTo(38,0);expect(dimensions.position).toBe('absolute');
});


test('a slow signature move never starts idle rocking early and live Reduce Motion stops it', async ({page}) => {
  await page.clock.install();
  await page.evaluate(event('move',20,30));
  await page.evaluate(event('move',350,700));
  await page.evaluate(event('click'));
  await page.clock.runFor(660);
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.sway').classList.contains('idle'))).toBe(false);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.runFor(20);
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.position').style.transform)).toBe('translate3d(350px, 700px, 0px)');
  await page.clock.runFor(1200);
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.halo').style.opacity)).toBe('0.4');
  expect(await page.evaluate(()=> (window as any).__cursorTestRoot.querySelector('.sway').getAnimations().length)).toBe(0);
});


test('enabling Reduce Motion cancels a live click pulse and restores resting glow', async ({page}) => {
  await page.clock.install();
  await page.evaluate(event('move',150,160));
  await page.evaluate(event('click'));
  await page.clock.runFor(50);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>page.evaluate(()=>getComputedStyle((window as any).__cursorTestRoot.querySelector('.halo')).opacity)).toBe('0.4');
  expect(await page.evaluate(()=>['.halo','.arrow'].map(selector=>(window as any).__cursorTestRoot.querySelector(selector).getAnimations().length))).toEqual([0,0]);
});
