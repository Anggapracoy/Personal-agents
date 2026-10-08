import { test, expect } from '@playwright/test';
import { spawnSync } from '../helpers/process';
import type { BrowserSnapshot } from '../../lib/harness/browser/cloud';
import { CLOUD_BROWSER_CONTROLLER } from '../../lib/harness/browser/cloud-controller';

const extraction = spawnSync('python3', ['-c', `import sys,json
ns={'__name__':'test_controller'}
exec(sys.stdin.read(),ns)
mask=[]
ns['frame_contexts']=lambda cdp:[{}]
ns['evaluate_context']=lambda cdp,expression,context:mask.append(expression)
ns['set_secret_mask'](None,True)
ns['set_secret_mask'](None,False)
print(json.dumps({'helpers':ns['SHADOW_HELPERS'],'snapshot':ns['SNAPSHOT_EXPRESSION'].replace('__REF_START__','0'),'mask':mask}))`], {input:CLOUD_BROWSER_CONTROLLER, encoding:'utf8'});
if (extraction.status !== 0) throw new Error(extraction.stderr);
const scripts = JSON.parse(extraction.stdout) as {helpers:string;snapshot:string;mask:string[]};
const scoped = (expression:string) => `(() => {${scripts.helpers}return (${expression});})()`;

test('nested shadow controls retain refs, scope, focus and hit-test boundaries', async ({page}) => {
  await page.setContent('<section role="region" aria-label="Settings"><div id="host"></div></section><div role="switch" aria-checked="mixed" aria-label="Alerts">Alerts</div>');
  await page.evaluate(() => {
    const outer=document.querySelector('#host')!.attachShadow({mode:'open'});
    outer.innerHTML='<div id="inner"></div>';
    outer.querySelector('#inner')!.attachShadow({mode:'open'}).innerHTML='<button>Shadow action</button><input aria-label="Shadow field">';
  });
  const snapshot=await page.evaluate(scripts.snapshot) as BrowserSnapshot;
  const button=snapshot.elements.find((e:{name:string})=>e.name==='Shadow action')!;
  const field=snapshot.elements.find((e:{name:string})=>e.name==='Shadow field')!;
  const region=snapshot.elements.find((e:{name:string})=>e.name==='Settings')!;
  expect(button.ref).toMatch(/^e\d+$/);
  expect(field.ancestorRefs).toContain(region.ref);
  expect(snapshot.elements.find((e:{name:string})=>e.name==='Alerts')).toMatchObject({role:'switch',checked:'mixed'});
  const again=await page.evaluate(scripts.snapshot) as BrowserSnapshot;
  expect(again.elements.find((e:{name:string})=>e.name==='Shadow field')!.ref).toBe(field.ref);
  expect(await page.evaluate(scoped(`(() => {const e=deepQuery('[data-decision-feed-ref="${field.ref}"]'); e.focus(); return deepActiveElement()===e;})()`))).toBe(true);
  expect(await page.evaluate(scoped(`(() => {const e=deepQuery('[data-decision-feed-ref="${button.ref}"]'); const r=e.getBoundingClientRect(); return deepElementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()`))).toBe(true);
  expect(await page.evaluate(scoped(`composedContains(document.querySelector('#host'), deepQuery('[data-decision-feed-ref="${button.ref}"]'))`))).toBe(true);
  await page.evaluate(() => { const overlay=document.createElement('div'); overlay.style.cssText='position:fixed;inset:0;z-index:999;background:white'; document.body.append(overlay); });
  expect(await page.evaluate(scoped(`(() => {const e=deepQuery('[data-decision-feed-ref="${button.ref}"]'); const r=e.getBoundingClientRect(); return deepElementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()`))).toBe(false);
  await page.evaluate(() => document.querySelector('#host')!.setAttribute('aria-hidden','true'));
  const hidden=await page.evaluate(scripts.snapshot) as BrowserSnapshot;
  expect(hidden.elements.some((e:{ref:string})=>e.ref===button.ref)).toBe(false);
});

test('secret masking reaches nested shadow roots and is removed afterward', async ({page}) => {
  await page.setContent('<div id="host"></div>');
  await page.evaluate(() => {document.querySelector('#host')!.attachShadow({mode:'open'}).innerHTML='<input data-decision-feed-secret="true" value="dummy">';});
  await page.evaluate(scoped(scripts.mask[0]));
  expect(await page.evaluate(scoped(`getComputedStyle(deepQuery('input')).webkitTextFillColor`))).toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(scoped(scripts.mask[1]));
  expect(await page.evaluate(scoped(`deepQueryAll('#decision-feed-secret-mask').length`))).toBe(0);
});

test('hit diagnostics distinguish coverage, pointer events and offscreen geometry without values or page text', async ({page}) => {
  await page.setContent('<button data-decision-feed-ref="e1" style="width:160px;height:60px">private-order-text</button><input value="private-card-value">');
  const probe=()=>page.evaluate(scoped(`targetHitState(deepQuery('[data-decision-feed-ref="e1"]'))`)) as Promise<any>;
  expect((await probe()).receivesInput).toBe(true);
  await page.locator('button').evaluate(e=>(e as HTMLElement).style.pointerEvents='none');
  expect(await probe()).toMatchObject({pointerEvents:'none',receivesInput:false,centerInViewport:true});
  await page.locator('button').evaluate(e=>(e as HTMLElement).style.pointerEvents='auto');
  await page.evaluate(()=>{const cover=document.createElement('div');cover.setAttribute('data-decision-feed-ref','e2');cover.style.cssText='position:fixed;inset:0;z-index:999';document.body.append(cover);});
  expect(await probe()).toMatchObject({receivesInput:false,hit:{tag:'DIV',ref:'e2'}});
  await page.locator('button').evaluate(e=>(e as HTMLElement).style.transform='translateY(2000px)');
  const report=await probe();
  expect(report).toMatchObject({centerInViewport:false,hit:null});
  expect(JSON.stringify(report)).not.toContain('private-');
});

test('waitable DOM observations include native headings and unnamed landmarks', async ({page}) => {
  await page.setContent('<main><h2>Conversations</h2><button>Refresh</button></main><nav><a href="#inbox" aria-label="Inbox 11 unread">Inbox</a></nav>');
  const snapshot = await page.evaluate(scripts.snapshot) as BrowserSnapshot;
  const main = snapshot.elements.find(item => item.role === 'main');
  expect(main?.name).toBe('');
  const heading = snapshot.elements.find(item => item.role === 'heading' && item.name === 'Conversations');
  expect(heading?.ancestorRefs).toContain(main?.ref);
  expect(snapshot.elements.find(item => item.role === 'link')?.name).toBe('Inbox 11 unread');
});

test('repeated observations retain references without redundant DOM mutations', async ({page}) => {
  await page.setContent('<main><button>Open</button><label>Note<input></label><div id="shadow"></div></main>');
  await page.evaluate(() => document.querySelector('#shadow')!.attachShadow({mode:'open'}).innerHTML='<button>Shadow</button>');
  const first=await page.evaluate(scripts.snapshot) as BrowserSnapshot;
  await page.evaluate(() => {
    const mutations:MutationRecord[]=[];
    const observer=new MutationObserver(rows=>mutations.push(...rows));
    observer.observe(document,{subtree:true,attributes:true});
    observer.observe(document.querySelector('#shadow')!.shadowRoot!,{subtree:true,attributes:true});
    Object.assign(window,{probeMutations:mutations,probeObserver:observer});
  });
  const second=await page.evaluate(scripts.snapshot) as BrowserSnapshot;
  expect(second.elements).toEqual(first.elements);
  expect(await page.evaluate(()=>(window as any).probeMutations.length)).toBe(0);
  await page.evaluate(() => document.querySelector('button')!.removeAttribute('data-decision-feed-ref'));
  const repaired=await page.evaluate(scripts.snapshot) as BrowserSnapshot;
  expect(repaired.elements).toEqual(first.elements);
  expect(await page.locator('button').first().getAttribute('data-decision-feed-ref')).toBe(first.elements.find(e=>e.name==='Open')!.ref);
});
