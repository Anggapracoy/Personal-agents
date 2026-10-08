import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from './helpers/process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';

test('hidden waits require complete observations and remain bounded', () => {
  const start=CLOUD_BROWSER_CONTROLLER.indexOf('def wait_for_target(');
  const source=CLOUD_BROWSER_CONTROLLER.slice(start,CLOUD_BROWSER_CONTROLLER.indexOf('def press_key(',start));
  const result=spawnSync('python3',['-c',source+`
class Clock:
 def __init__(self): self.now=0
 def monotonic(self): return self.now
 def sleep(self,seconds): self.now+=seconds
time=Clock()
partial={"elements":[],"warnings":["A frame could not be observed"]}
visible={"elements":[{"ref":"e1","disabled":False}],"warnings":[]}
hidden={"elements":[],"warnings":[]}
observed=[]
pages=iter([partial,visible,hidden])
def snapshot(cdp):
 page=next(pages);observed.append(page);return page
assert wait_for_target(None,"e1","hidden",1000) is hidden
assert len(observed)==3, "An incomplete observation was mistaken for hidden"
def snapshot(cdp): return partial
try: wait_for_target(None,"e1","hidden",100)
except RuntimeError as error: assert 'timed out' in str(error)
else: raise AssertionError('Incomplete observation incorrectly satisfied hidden wait')
# Positive evidence remains useful even if an unrelated frame is unavailable.
def snapshot(cdp): return dict(visible,warnings=partial['warnings'])
assert wait_for_target(None,"e1","enabled",100)['elements'][0]['ref']=='e1'
`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('input readiness waits out movement and overlays without comparing page content', () => {
  const start=CLOUD_BROWSER_CONTROLLER.indexOf('def wait_for_input_ready(');
  const source=CLOUD_BROWSER_CONTROLLER.slice(start,CLOUD_BROWSER_CONTROLLER.indexOf('def ready(',start));
  const result=spawnSync('python3',['-c','import json\n'+source+`
class PreDispatchError(RuntimeError): pass
class Clock:
 def __init__(self): self.now=0
 def monotonic(self): return self.now
 def sleep(self,seconds): self.now+=seconds
time=Clock()
identity_reads=0
def find_ref(cdp,ref,native_identity=True):
 assert native_identity is False
 return {'contextId':1,'x':50,'y':20}
def describe(cdp,ref):
 global identity_reads
 identity_reads+=1
 return {'contextId':1,'x':50,'y':20,'name':'Fresh native identity'}
def assert_frame_uncovered(*args): pass
reads=0
def evaluate(cdp,expression,*args):
 global reads
 reads+=1
 return {'rect':[min(reads,3),0,100,30],'enabled':True,'visible':True,'receivesInput':reads>=4}
assert wait_for_input_ready(None,'e1')['x']==50
assert reads==4
assert identity_reads==1
# Keyboard activation needs focusability, not a pointer hit target.
def evaluate(*args): return {'rect':[0,0,100,30],'enabled':True,'visible':True,'receivesInput':False}
wait_for_input_ready(None,'e1',pointer=False)
for expected,state in [
 ('covered',{'rect':[0,0,100,30],'enabled':True,'visible':True,'receivesInput':False}),
 ('disabled',{'rect':[0,0,100,30],'enabled':False,'visible':True,'receivesInput':True}),
 ('hidden',{'rect':[0,0,0,0],'enabled':True,'visible':False,'receivesInput':True})]:
 def evaluate(*args): return state
 try: wait_for_input_ready(None,'e1',timeout=.2)
 except PreDispatchError as error:
  assert 'no input was dispatched' in str(error)
  assert expected in str(error)
 else: raise AssertionError('non-actionable target accepted')
`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
