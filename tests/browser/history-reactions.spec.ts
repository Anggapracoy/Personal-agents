import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({ entryPoints:['tests/browser/fixtures/history-reactions.tsx'], bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic', define:{'process.env.NODE_ENV':'"development"'} }).outputFiles[0].text;
async function mount(page: import('@playwright/test').Page, native: boolean) {
  await page.route('**/history-reactions-fixture*', route => route.fulfill({contentType:'text/html', body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
  await page.goto(`/history-reactions-fixture?native=${native ? 1 : 0}`);
  for (const path of ['app/brand-tokens.css','app/wdyt.css']) await page.addStyleTag({content:readFileSync(path,'utf8')});
  await page.addScriptTag({content:bundle});
}
test('native no-action history exposes reactions for both messages and retains Dash acknowledgment', async ({page}) => {
  await mount(page, true);
  await expect.poll(() => page.evaluate(() => (window as any).menuFeedback.findLast((m:any) => m.action==='messageMenuItems')?.payload.items.map((i:any) => ({text:i.text,canReact:i.canReact})))).toEqual([{text:'Keep your current subscription?',canReact:true},{text:'Leave it',canReact:true}]);
  await page.evaluate(async () => {
    const w=window as any;
    const item=w.menuFeedback.findLast((m:any)=>m.action==='messageMenuItems').payload.items.find((i:any)=>i.text==='Leave it');
    await w.__decisionFeedMessageAction(item.key,'react','❤️');
  });
  await expect(page.getByRole('button',{name:'You reacted ❤️, change reaction'})).toBeVisible();
  await expect(page.locator('.wd-tapback').filter({hasText:'👍'})).toBeVisible();
  await expect(page.getByText('No action taken.')).toHaveCount(0);
});
test('web long-press exposes reactions on the user choice and original suggestion', async ({page}) => {
  await mount(page, false);
  for (const text of ['Leave it','Keep your current subscription?']) {
    const bubble=page.locator('.wd-reactable').filter({hasText:text}).first();
    await bubble.dispatchEvent('contextmenu');
    await expect(page.getByRole('button',{name:'Heart',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.screenshot({path:'/tmp/dash-no-action-reaction.png'});
});
