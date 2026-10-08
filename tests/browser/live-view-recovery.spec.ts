import {test,expect} from '@playwright/test';
import {liveViewPage} from '../../lib/harness/browser/live-view-page';

test.beforeEach(async({page})=>{
 await page.goto('/__browser-viewer-fixture');
 await page.evaluate(()=>{
  (window as any).streams=[];
  class MockSocket {
   static OPEN=1;readyState=1;
   onopen:any;onclose:any;onmessage:any;onerror:any;binaryType='';
   constructor(public url:string){(window as any).streams.push(this);setTimeout(()=>this.onopen?.(),0);}
   send(data:string){(window as any).streamInputs??=[];(window as any).streamInputs.push(JSON.parse(data));}
   close(){}
  }
  (window as any).WebSocket=MockSocket;
 });
});
async function start(page:any,active:()=>boolean,control=false){
 const loads:string[]=[];
 await page.route('**/api/runs/stream-test/browser?*',(route:any)=>{
  loads.push(route.request().url());
  return route.fulfill({json:active()?{active:true,url:'https://production-sfo.browserless.io/live/index.html?i=fixture'}:{active:false}});
 });
 await page.setContent(liveViewPage('stream-test',control).html);
 await expect.poll(()=>page.evaluate(()=>(window as any).streams.length)).toBe(1);
 return loads;
}
async function draw(page:any){
 await page.evaluate(()=>{(window as any).streams.at(-1).onmessage({data:JSON.stringify({command:'startComplete',data:{}})});const blob=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="white"/><text x="100" y="150" font-size="40">Browser still working</text></svg>'],{type:'image/svg+xml'});(window as any).streams.at(-1).onmessage({data:blob});});
 await expect(page.locator('canvas')).toHaveAttribute('data-ready','true');
}
async function complete(page:any,reason='viewer-ended'){await page.evaluate((reason:string)=>(window as any).streams.at(-1).onmessage({data:JSON.stringify({command:'runComplete',data:{reason}})}),reason);}

test('stream ends while task remains active: recover the view and retain its last frame',async({page})=>{
 const loads=await start(page,()=>true);await draw(page);await complete(page);
 await expect.poll(()=>page.evaluate(()=>(window as any).streams.length)).toBe(2);
 expect(loads[1]).toContain('refresh=1');
 await expect(page.locator('canvas')).toHaveAttribute('data-ready','true');
 await expect(page.getByText('All done!',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).streamInputs.map((x:any)=>x.command))).toEqual(['start','start']);
 await draw(page);await expect(page.getByRole('status',{includeHidden:true})).toHaveText('');
 await page.screenshot({path:'/tmp/dash-live-view-recovery.png'});
});
test('actual task completion stops without creating a replacement stream',async({page})=>{
 let active=true;const loads=await start(page,()=>active);await draw(page);active=false;await complete(page);
 await expect(page.getByRole('status')).toHaveText('Task finished.');
 expect(loads.length).toBe(2);expect(await page.evaluate(()=>(window as any).streams.length)).toBe(1);
});
test('credential protection completion never automatically reopens the viewer',async({page})=>{
 const loads=await start(page,()=>true);await complete(page,'credential-protection');
 await expect(page.getByRole('status')).toHaveText('Browser hidden during private input.');expect(loads.length).toBe(1);
});
test('closing the page shuts down retries',async({page})=>{
 const loads=await start(page,()=>true);await complete(page);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await page.waitForTimeout(600);expect(loads.length).toBe(1);
});

test('closing during descriptor loading cannot open a late stream',async({page})=>{
 let respond:(()=>Promise<void>)|undefined;
 await page.route('**/api/runs/stream-test/browser?*',route=>new Promise<void>(resolve=>{
  respond=async()=>{await route.fulfill({json:{active:true,url:'https://production-sfo.browserless.io/live/index.html?i=fixture'}});resolve();};
 }));
 await page.setContent(liveViewPage('stream-test').html);
 await expect.poll(()=>Boolean(respond)).toBe(true);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await respond!();await page.waitForTimeout(400);
 expect(await page.evaluate(()=>(window as any).streams.length)).toBe(0);
});

async function touchDrag(page:any,cancel=false){await page.evaluate((cancel:boolean)=>{const canvas=document.querySelector('canvas')!;canvas.setPointerCapture=()=>{};const r=canvas.getBoundingClientRect();const point={clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch',pointerId:1,isPrimary:true,button:0,buttons:1,bubbles:true,cancelable:true};canvas.dispatchEvent(new PointerEvent('pointerdown',point));canvas.dispatchEvent(new PointerEvent('pointermove',{...point,clientX:point.clientX+20}));canvas.dispatchEvent(new PointerEvent(cancel?'pointercancel':'pointerup',{...point,clientX:point.clientX+20,buttons:0}));},cancel);}
test('takeover touch Drag forwards a held mouse drag with letterbox coordinates',async({page})=>{
 const loads=await start(page,()=>true,true);await draw(page);expect(loads[0]).toContain('control=1');await page.getByRole('button',{name:'Scroll mode',exact:true}).click();await touchDrag(page);
 const events=await page.evaluate(()=>(window as any).streamInputs.filter((x:any)=>x.command==='Input.dispatchMouseEvent').map((x:any)=>x.data));
 expect(events.map((x:any)=>[x.type,x.button])).toEqual([['mousePressed','left'],['mouseMoved','left'],['mouseReleased','left']]);expect(events[0].x).toBeCloseTo(720,1);expect(events[0].y).toBeCloseTo(450,1);expect(events[2].x).toBeGreaterThan(events[0].x);
});
test('takeover Scroll retains scrolling, cancellation releases drag, and keyboard forwards input',async({page})=>{
 await start(page,()=>true,true);await draw(page);await touchDrag(page);let events=await page.evaluate(()=>(window as any).streamInputs.filter((x:any)=>x.command==='Input.dispatchMouseEvent'));expect(events.map((x:any)=>x.data.type)).toEqual(['mouseWheel']);
 await page.getByRole('button',{name:'Scroll mode',exact:true}).click();await touchDrag(page,true);events=await page.evaluate(()=>(window as any).streamInputs.filter((x:any)=>x.command==='Input.dispatchMouseEvent'));expect(events.at(-1).data.type).toBe('mouseReleased');
 await page.locator('canvas').focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>(window as any).streamInputs.some((x:any)=>x.command==='Input.dispatchKeyEvent'&&x.data.key==='Enter'))).toBe(true);
});
test('passive viewing never forwards touch or keyboard input',async({page})=>{
 await start(page,()=>true);await draw(page);await touchDrag(page);await page.locator('canvas').dispatchEvent('keydown',{key:'Enter'});expect(await page.evaluate(()=>(window as any).streamInputs.map((x:any)=>x.command))).toEqual(['start']);await expect(page.getByRole('button',{name:'Scroll mode'})).toBeHidden();
});

test('takeover completion stops and expired sessions require explicit reopening',async({page})=>{
 const loads=await start(page,()=>true,true);await draw(page);await complete(page);await expect(page.getByRole('status')).toHaveText('Control session ended. Return to the conversation.');expect(loads.length).toBe(1);
 await page.route('**/api/runs/expired-test/browser?*',route=>route.fulfill({status:503,json:{expired:true,canReopen:true}}));await page.setContent(liveViewPage('expired-test',true).html);await expect(page.getByRole('button',{name:'Reopen page',exact:true})).toBeVisible();await expect(page.getByRole('status')).toHaveText('This browser session expired.');
});

test('takeover pointer follows local input without intercepting or sending extra events',async({page})=>{
 await start(page,()=>true,true);await draw(page);
 const canvas=page.locator('canvas');const r=(await canvas.boundingBox())!;const x=r.x+r.width/2,y=r.y+r.height/2;
 const before=await page.evaluate(()=>(window as any).streamInputs.length);await page.mouse.move(x,y);
 await expect(page.locator('.takeover-pointer')).toBeVisible();expect(await page.locator('.takeover-pointer').evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');expect(await page.evaluate(()=>(window as any).streamInputs.length)).toBe(before);
 await page.mouse.down();await expect(page.locator('.takeover-pointer')).toHaveAttribute('data-pressed','true');await page.screenshot({path:'/tmp/dash-takeover-pointer.png'});await page.mouse.up();await expect(page.locator('.takeover-pointer')).toHaveAttribute('data-pressed','false');await complete(page);await expect(page.locator('.takeover-pointer')).toBeHidden();
});

test('takeover toolbar keeps icons through mode switches and keyboard remains usable', async ({ page }) => {
 await start(page,()=>true,true);await draw(page);
 const mode=page.getByRole('button',{name:'Scroll mode',exact:true});
 await expect(mode.locator('svg')).toHaveCount(1);
 await page.locator('.takeover-controls').screenshot({path:'/tmp/dash-takeover-toolbar.png'});
 await mode.click();
 await expect(page.getByRole('button',{name:'Drag mode',exact:true}).locator('svg')).toHaveCount(1);
 await page.getByRole('button',{name:'Keyboard',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Type in remote browser'})).toBeVisible();
});

test('keyboard uses an invisible relay and keeps the frame fixed while the viewport shrinks',async({page})=>{
 await start(page,()=>true,true);await draw(page);
 const before=await page.locator('canvas').boundingBox();await page.getByRole('button',{name:'Keyboard',exact:true}).click();
 const text=page.getByRole('textbox',{name:'Type in remote browser'});await expect(text).toBeFocused();await expect(text).toHaveCSS('opacity','0');
 await page.setViewportSize({width:393,height:500});const after=await page.locator('canvas').boundingBox();expect(after!.width).toBeCloseTo(before!.width,0);expect(after!.height).toBeCloseTo(before!.height,0);expect(after!.y).toBeCloseTo(before!.y,0);
 await text.fill('hello');expect(await page.evaluate(()=>(window as any).streamInputs.some((x:any)=>x.command==='pasteClipboard'&&x.data.content==='hello'))).toBe(true);
});
test('a tapped field entering a remote text cursor opens typing, but ordinary taps do not',async({page})=>{
 await start(page,()=>true,true);await draw(page);const c=page.locator('canvas');await c.evaluate(el=>{el.setPointerCapture=()=>{};});const p={pointerId:7,pointerType:'touch',isPrimary:true,clientX:100,clientY:100,button:0,bubbles:true};
 await c.dispatchEvent('pointerdown',p);await c.dispatchEvent('pointerup',p);await expect(page.locator('[data-browser-text]')).not.toBeFocused();
 await page.evaluate(()=>(window as any).streams.at(-1).onmessage({data:JSON.stringify({command:'cursorChange',data:'text'})}));
 await expect(page.locator('[data-browser-text]')).toBeFocused();await expect(page.locator('[data-browser-text]')).toHaveCSS('opacity','0');
});
