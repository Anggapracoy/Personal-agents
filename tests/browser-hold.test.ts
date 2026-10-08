import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from './helpers/process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
import { runBrowserScript } from '../lib/harness/browser/script';
const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def pointer_click('),CLOUD_BROWSER_CONTROLLER.indexOf('def press_key('));
test('holds validate duration and always release on interrupted waits',()=>{
 const r=spawnSync('python3',['-c',source+`
class Clock:
 def sleep(self, seconds):
  assert seconds == 5
  raise KeyboardInterrupt()
time=Clock()
class CDP:
 def __init__(self): self.events=[]
 def command(self, method, params, session_id=None): self.events.append((params['type'], session_id))
c=CDP()
try: pointer_click(c, {'x':1,'y':2,'button':'left'},1,5000,'frame')
except KeyboardInterrupt: pass
assert c.events == [('mousePressed','frame'),('mouseReleased','frame')]
for duration in [-1,10001,1.5,True,'5000']:
 c=CDP()
 try: pointer_click(c,{},1,duration)
 except RuntimeError: pass
 else: raise AssertionError('accepted invalid hold')
 assert not c.events
c=CDP()
try: pointer_click(c,{},2,5000)
except RuntimeError: pass
else: raise AssertionError('accepted double hold')
assert not c.events
pointer_click(c,{},2,0)
assert [e[0] for e in c.events] == ['mousePressed','mouseReleased']*2
`],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
test('browser_run forwards hold duration on its existing click action',async()=>{
 let click:unknown;
 const result=await runBrowserScript(`await browser.page().getByText('Hold').click({holdMs:5000,purpose:'Hold control',requiresApproval:false});`,async(name,args)=>{
  if(name==='browser_click')click=args;
  return name==='browser_extended'?{matches:[{ref:'e1'}]}:{};
 });
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(click,{ref:{locator:{text:'Hold'}},holdMs:5000,purpose:'Hold control',requiresApproval:false});
});
