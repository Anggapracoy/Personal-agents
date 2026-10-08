import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../../lib/harness/browser/cloud-controller';

test('controller key sequences reach a keyboard-driven board as trusted events without submitting', async ({page}) => {
  const result = spawnSync('python3', ['-c', `import sys,json
ns={'__name__':'test'}
exec(sys.stdin.read(),ns)
events=[]
class CDP:
 def command(self,method,args): events.append([method,args])
ns['hide_visual_cursor']=lambda cdp:None
ns['press_key'](CDP(),'slate')
print(json.dumps(events))`], {input:CLOUD_BROWSER_CONTROLLER,encoding:'utf8'});
  expect(result.status, result.stderr).toBe(0);
  await page.setContent('<button>Keyboard</button><output></output><script>window.submits=0;window.trusted=[];document.addEventListener("keydown",e=>{window.trusted.push(e.isTrusted);if(e.key==="Enter")window.submits++;else if(/^[a-z]$/.test(e.key))document.querySelector("output").textContent+=e.key;});</script>');
  await page.getByRole('button').focus();
  const cdp = await page.context().newCDPSession(page);
  for (const [method,args] of JSON.parse(result.stdout)) await cdp.send(method,args);
  await expect(page.locator('output')).toHaveText('slate');
  expect(await page.evaluate(() => ({submits:(window as any).submits,trusted:(window as any).trusted}))).toEqual({submits:0,trusted:[true,true,true,true,true]});
});
