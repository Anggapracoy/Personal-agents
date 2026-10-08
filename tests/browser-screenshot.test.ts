import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from './helpers/process';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
const helper=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def capture_screenshot('),CLOUD_BROWSER_CONTROLLER.indexOf('def set_secret_mask('));
test('screenshot retries are bounded, read-only, and reject missing frames',()=>{
 const result=spawnSync('python3',['-c',`import time,json\n${helper}
class CDP:
 def __init__(self, failures): self.failures=failures; self.calls=[]
 def command(self, method, params, timeout):
  self.calls.append((method,params,timeout))
  assert method == 'Page.captureScreenshot'
  assert timeout == (1.5 if len(self.calls)==1 else 2.5) and params['optimizeForSpeed']
  assert params['fromSurface'] == (len(self.calls)==1)
  if len(self.calls)<=self.failures: raise RuntimeError('CDP timed out https://secret.invalid/token')
  return {'data':'png'}
c=CDP(0); result, attempts=capture_screenshot(c); assert result['data']=='png' and len(c.calls)==1
c=CDP(1); result, attempts=capture_screenshot(c); assert len(c.calls)==2 and attempts[0]['status']=='timeout'
c=CDP(2)
try: capture_screenshot(c)
except RuntimeError as e: assert 'two bounded attempts' in str(e) and 'secret' not in str(e)
else: raise AssertionError('should fail')
assert len(c.calls)==2
class Empty(CDP):
 def command(self,*args,**kwargs): return {}
try: capture_screenshot(Empty(0))
except RuntimeError: pass
else: raise AssertionError('accepted empty frame')
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
