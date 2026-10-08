import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {buildSync}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=buildSync({entryPoints:['tests/browser/fixtures/choice-panels.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
const html=`<style>${readFileSync('app/brand-tokens.css','utf8')}\n${readFileSync('app/wdyt.css','utf8')}</style><div id="root"></div><script>${bundle.replaceAll('</script','<\\/script')}</script>`;
test.beforeEach(async({page})=>{await page.route('**/choice-preview*',route=>route.fulfill({contentType:'text/html',body:html}));});
test('single choice selects a row and Continue submits it without a custom field',async({page})=>{
 let submitted:any;let calls=0;await page.route('**/api/runs/choice-test/questions',async route=>{calls++;submitted=route.request().postDataJSON();await route.fulfill({json:{}});});await page.goto('/choice-preview');
 await expect(page.getByPlaceholder('Type your own answer')).toHaveCount(0);await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
 await page.getByRole('radio',{name:'6:00 PM'}).click();await expect(page.getByRole('radio',{name:'6:00 PM'})).toHaveAttribute('aria-checked','true');expect(calls).toBe(0);
 await page.getByRole('button',{name:'Continue',exact:true}).click();await expect.poll(()=>submitted?.responses[0]).toEqual({questionId:'time',selectedOptionIds:['a'],text:''});expect(calls).toBe(1);
});
test('multiple selections submit together and Skip dismisses',async({page})=>{let submitted:any;await page.route('**/api/runs/choice-test/questions',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{}});});await page.goto('/choice-preview?multi=1');for(const name of ['6:00 PM','7:00 PM']){await page.getByRole('checkbox',{name}).click();await expect(page.getByRole('checkbox',{name})).toHaveAttribute('aria-checked','true');}await page.getByRole('button',{name:'Continue',exact:true}).click();await expect.poll(()=>submitted?.responses[0].selectedOptionIds).toEqual(['a','b']);await expect(page.getByLabel('Your answers')).toContainText('7:00 PM');await page.reload();await page.getByRole('button',{name:'Skip',exact:true}).click();expect(await page.evaluate(()=>(window as any).dismissed)).toBe(true);});
test('proactive options are buttons that choose immediately, with the first as primary',async({page})=>{await page.goto('/choice-preview?proactive=1');await expect(page.getByRole('button',{name:'6:00 PM',exact:true})).toHaveClass(/is-primary/);await expect(page.getByRole('button',{name:'7:00 PM',exact:true})).toHaveClass(/is-secondary/);await page.getByRole('button',{name:'7:00 PM',exact:true}).click();expect(await page.evaluate(()=>(window as any).chosen)).toBe('b');await expect(page.getByPlaceholder('Type your own answer')).toHaveCount(0);});

test('receipt appears before slow saving finishes and restores choices on failure',async({page})=>{
 let finish:(()=>Promise<void>)|undefined;
 await page.route('**/api/runs/choice-test/questions',async route=>{await new Promise<void>(resolve=>{finish=async()=>{await route.fulfill({status:503,json:{error:'Try again'}});resolve();};});});
 await page.goto('/choice-preview');await page.getByRole('radio',{name:'7:00 PM'}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByLabel('Saving your choice')).toBeVisible({timeout:500});await expect(page.getByLabel('Saving your choice')).toContainText('7:00 PM');await expect(page.getByRole('radio',{name:'6:00 PM'})).toHaveCount(0);
 await expect.poll(()=>Boolean(finish)).toBe(true);await finish!();await expect(page.getByRole('radio',{name:'7:00 PM'})).toBeVisible();await expect(page.getByText('Try again',{exact:true})).toBeVisible();
});

test('choice collapse keeps its surface and width stable while it becomes a receipt',async({page})=>{
 await page.route('**/api/runs/choice-test/questions',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({json:{}});});await page.goto('/choice-preview');
 const before=await page.locator('.wd-question-card').evaluate(el=>({width:el.getBoundingClientRect().width,background:getComputedStyle(el).backgroundColor}));
 await page.getByRole('radio',{name:'7:00 PM'}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
 const samples=await page.locator('.wd-receipts').evaluate(async el=>{const samples:any[]=[];const start=performance.now();await new Promise<void>(resolve=>{const sample=()=>{const frame=el.closest<HTMLElement>('.wd-inline-panel-frame')!;if(frame.dataset.bubbleTransition)samples.push({width:frame.getBoundingClientRect().width,background:getComputedStyle(frame).backgroundColor});if(performance.now()-start<300)requestAnimationFrame(sample);else resolve();};sample();});return samples;});
 expect(samples.length).toBeGreaterThan(0);
 for(const sample of samples){expect(sample.width).toBeCloseTo(before.width,1);expect(sample.background).toBe(before.background);}
});

test('outgoing card never flashes back after its fade finishes',async({page})=>{
 await page.route('**/api/runs/choice-test/questions',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({json:{}});});await page.goto('/choice-preview');
 await page.getByRole('radio',{name:'7:00 PM'}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
 const samples=await page.evaluate(async()=>{const values:number[]=[];const start=performance.now();await new Promise<void>(resolve=>{const sample=()=>{const ghost=document.querySelector('.wd-inline-panel-ghost');values.push(ghost?Number(getComputedStyle(ghost).opacity):0);if(performance.now()-start<280)requestAnimationFrame(sample);else resolve();};sample();});return values;});
 for(let i=1;i<samples.length;i++)expect(samples[i]).toBeLessThanOrEqual(samples[i-1]+.01);
 await expect(page.locator('.wd-inline-panel-ghost')).toHaveCount(0);await expect(page.getByRole('button',{name:'Skip',exact:true})).toHaveCount(0);
});
