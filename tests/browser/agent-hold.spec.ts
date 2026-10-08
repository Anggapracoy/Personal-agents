import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CLOUD_BROWSER_CONTROLLER } from '../../lib/harness/browser/cloud-controller';
test('controller sends a real five-second press to a browser page',async({page,context})=>{
 await page.setContent(`<button style="position:fixed;inset:0;width:100%;height:100%">Hold</button><script>window.events=[];for(const type of ['pointerdown','pointerup'])document.addEventListener(type,e=>events.push({type,t:performance.now()}));</script>`);
 const cdp=await context.newCDPSession(page);
 const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def pointer_click('),CLOUD_BROWSER_CONTROLLER.indexOf('def press_key('));
 const child=spawn('python3',['-u','-c','import time,json\n'+source+`
class CDP:
 def command(self, method, params, session_id=None):
  print(json.dumps({'method':method,'params':params}),flush=True)
  input()
pointer_click(CDP(),{'x':100,'y':100,'button':'left'},1,5000)
`]);
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 const exited=new Promise<number|null>(resolve=>child.on('exit',resolve));
 try {
  for await(const line of createInterface({input:child.stdout})){
   const message=JSON.parse(line);
   await cdp.send(message.method,message.params);
   child.stdin.write('ok\n');
  }
  expect(await exited,stderr).toBe(0);
  const events=await page.evaluate(()=>(window as any).events);
  expect(events.map((e:any)=>e.type)).toEqual(['pointerdown','pointerup']);
  expect(events[1].t-events[0].t).toBeGreaterThanOrEqual(4900);
  expect(events[1].t-events[0].t).toBeLessThan(7000);
 }finally{child.kill();}
});
