import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('interrupted push preserves Home pixels across back capture and first pop frame', async ({ page }) => {
  await page.setContent('<div class="wd" style="width:393px;height:852px"><div class="wd-main"><div class="wd-home-layer is-current"><div style="padding:90px 20px">Home<br>Conversation one<br>Conversation two</div></div></div></div>');
  await page.addStyleTag({content:readFileSync('app/wdyt.css','utf8')});
  const source = ts.transpileModule(readFileSync('app/navigation-motion.ts','utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  await page.addScriptTag({type:'module',content:source+'\nwindow.createNavigationMotion = createNavigationMotion;'});
  await page.waitForFunction(() => Boolean((window as any).createNavigationMotion));
  const positions = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('.wd')!;
    const main = root.querySelector('.wd-main')!;
    const home = root.querySelector<HTMLElement>('.wd-home-layer')!;
    const motion = (window as any).createNavigationMotion(() => root);
    motion.capture('chat','home');
    const chat = document.createElement('div'); chat.className='wd-front-layer'; chat.innerHTML='<div style="padding:90px 20px">Chat</div>';main.append(chat);
    motion.navigate('push',0);
    for (let i=0;i<6;i++) await new Promise(requestAnimationFrame);
    motion.drag(.2);
    const before = home.getBoundingClientRect().x;
    const from = motion.capture('home','chat');
    const captured = home.getBoundingClientRect().x;
    // Deliberately allow capture to paint before the React-style replacement.
    await new Promise(requestAnimationFrame);
    const held = home.getBoundingClientRect().x;
    chat.remove(); motion.navigate('pop',from);
    const first = home.getBoundingClientRect().x;
    await new Promise<void>(resolve => setTimeout(resolve,700));
    const settled = home.getBoundingClientRect().x;
    motion.dispose();
    return {before,captured,held,first,settled,root:root.getBoundingClientRect().x};
  });
  expect(positions.before).toBeLessThan(positions.root);
  for(const x of [positions.captured,positions.held,positions.first]) expect(x).toBeCloseTo(positions.before,3);
  expect(positions.settled).toBeCloseTo(positions.root,3);
});
