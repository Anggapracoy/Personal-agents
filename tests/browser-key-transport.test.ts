import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';

const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('    def type_keys(self, text'),CLOUD_BROWSER_CONTROLLER.indexOf('    def observations(self):')).replace(/^   /gm, '');
test('ordinary key transport preserves event order, waits for every acknowledgement and never replays failures',()=>{
 const run=spawnSync('python3',['-c',`import time,json,socket
class Transport:
${source}
 def __init__(self):
  self.next_id=1;self.page_session='page';self.sent=[];self.replies=[];self.events=[];self.sock=self;self.fail=None
 def settimeout(self,timeout): assert timeout>0
 def send(self,message):
  self.sent.append(message);self.replies.append({'id':message['id'],'result':{}})
 def receive(self):
  if self.fail: raise RuntimeError(self.fail)
  return self.replies.pop(0)
 def record_event(self,message): self.events.append(message)
t=Transport();t.type_keys('abcdefghijklmnopqrstuvwxyz',delay=0)
assert len(t.sent)==52 and not t.replies
for i,c in enumerate('abcdefghijklmnopqrstuvwxyz'):
 down,up=t.sent[2*i:2*i+2]
 assert down['params']=={'type':'keyDown','key':c,'text':c,'unmodifiedText':c}
 assert up['params']=={'type':'keyUp','key':c}
 assert down['sessionId']==up['sessionId']=='page'
for text in ['x'*513,'a\\nb','a\\tb',None]:
 t=Transport()
 try: t.type_keys(text,delay=0)
 except RuntimeError: pass
 else: raise AssertionError('invalid input accepted')
 assert not t.sent
t=Transport();t.fail='connection closed'
try: t.type_keys('x'*40,delay=0)
except RuntimeError: pass
else: raise AssertionError('failure swallowed')
assert len(t.sent)==32 # no later window and no replay
class Dialog(Transport):
 def receive(self): return {'method':'Page.javascriptDialogOpening','params':{'type':'alert'}}
t=Dialog()
try: t.type_keys('x'*40,delay=0)
except RuntimeError as error: assert 'not replayed' in str(error)
else: raise AssertionError('dialog ignored')
assert len(t.sent)==32 and len(t.events)==1
class Slow(Transport):
 def receive(self): raise socket.timeout()
t=Slow()
try: t.type_keys('x'*40,delay=0)
except RuntimeError as error: assert str(error)=='CDP command key sequence timed out; input was not replayed'
else: raise AssertionError('timeout swallowed')
assert len(t.sent)==32 # the timeout cannot dispatch the next window or replay

`],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});
