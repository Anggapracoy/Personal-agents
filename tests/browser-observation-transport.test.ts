import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from './helpers/process';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';

test('reference batches preserve frame results and reject scripts before sending',()=>{
 const methods=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('    def read_commands(self,'),CLOUD_BROWSER_CONTROLLER.indexOf('    def type_keys(self,'));
 const run=spawnSync('python3',['-c',`import time,socket,re,json
def extended_query_expression(locator):
 assert locator=={'ref':'e51'}
 return '__REF_COUNTER_INIT__ trusted query'
class Transport:
${methods}
    def __init__(self):
        self.next_id=1;self.page_session='page';self.sent=[];self.replies=[];self.sock=self
    def settimeout(self,value):assert value>0
    def send(self,message):self.sent.append(message)
    def receive(self):
        assert len(self.sent)==2
        return self.replies.pop(0)
    def record_event(self,message):pass
contexts=[{'contextId':1},{'contextId':2,'sessionId':'child'}]
t=Transport();t.replies=[{'id':2,'result':{'result':{'value':{'matches':[2]}}}},{'id':1,'result':{'result':{'value':{'matches':[1]}}}}]
assert t.reference_query(contexts,'e51')==[{'value':{'matches':[1]}},{'value':{'matches':[2]}}]
assert [(m['sessionId'],m['params']['contextId']) for m in t.sent]==[('page',1),('child',2)]
assert all(m['params']['expression']==' trusted query' for m in t.sent)
t=Transport();t.replies=[{'id':2,'error':{'message':'frame gone'}},{'id':1,'result':{'result':{'value':{'matches':[]}}}}]
assert t.reference_query(contexts,'e51')==[{'value':{'matches':[]}},{'error':'frame gone'}]
assert not t.replies
for frames,ref in [(contexts,'document.body.click()'),(contexts,{}),([], 'e51'),(contexts*33,'e51')]:
 t=Transport()
 try:t.reference_query(frames,ref)
 except RuntimeError:pass
 else:raise AssertionError('Unsafe query accepted')
 assert not t.sent
`],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});

test('parallel observations preserve reply order, drain errors, retain events and reject input',()=>{
 const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('    def read_commands(self,'),CLOUD_BROWSER_CONTROLLER.indexOf('    def type_keys(self,'));
 const run=spawnSync('python3',['-c',`import time,socket
class Transport:
${source}
    def __init__(self):
        self.next_id=1;self.page_session='page';self.sent=[];self.replies=[];self.events=[];self.sock=self
    def command(self, method, **kwargs): assert method=="DOM.disable"
    def settimeout(self,value): assert value>0
    def send(self,message): self.sent.append(message)
    def receive(self):
        assert len(self.sent)==2
        return self.replies.pop(0)
    def record_event(self,message): self.events.append(message)
commands=[{'method':'Accessibility.getFullAXTree'},{'method':'DOM.getDocument','params':{'depth':-1,'pierce':True}}]
t=Transport();t.replies=[{'method':'Page.frameNavigated'},{'id':2,'result':{'dom':1}},{'id':1,'result':{'ax':1}}]
assert t.read_commands(commands)==[{'ax':1},{'dom':1}]
assert len(t.events)==1 and all(m['sessionId']=='page' for m in t.sent)
t=Transport();t.replies=[{'id':1,'error':{'message':'frame gone'}},{'id':2,'result':{}}]
try:t.read_commands(commands,session_id='child')
except RuntimeError as e:assert str(e)=='frame gone'
else:raise AssertionError('error swallowed')
assert not t.replies and len(t.sent)==2 and all(m['sessionId']=='child' for m in t.sent)
for bad in [[],[{'method':'Input.dispatchMouseEvent'}],[{'method':'Runtime.evaluate'}],commands*33]:
 t=Transport()
 try:t.read_commands(bad)
 except RuntimeError:pass
 else:raise AssertionError('unsafe command accepted')
 assert not t.sent
t=Transport();t.replies=[{'id':2,'result':{'dom':1}},{'id':1,'error':{'message':'child detached'}}]
scoped=[dict(commands[0],sessionId='child'),commands[1]]
assert t.read_commands(scoped,settled=True)==[{'error':'child detached'},{'result':{'dom':1}}]
assert t.sent[0]['sessionId']=='child' and t.sent[1]['sessionId']=='page'
class Timeout(Transport):
 def receive(self):raise socket.timeout()
t=Timeout()
try:t.read_commands(commands)
except RuntimeError as e:assert 'timed out' in str(e)
else:raise AssertionError('timeout swallowed')
assert len(t.sent)==2
t=Transport();t.replies=[{'id':2,'result':{'targetInfos':[]}},{'id':1,'result':{'frameTree':{}}}]
assert t.read_commands([{'method':'Page.getFrameTree'},{'method':'Target.getTargets'}],settled=True)==[{'result':{'frameTree':{}}},{'result':{'targetInfos':[]}}]
assert t.sent[0]['sessionId']=='page' and 'sessionId' not in t.sent[1]
`],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});

test('lifecycle diagnostics avoid duplicate reads but retain action and failure samples',()=>{
 const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def browser_diagnostic('),CLOUD_BROWSER_CONTROLLER.indexOf('def find_ref('));
 const run=spawnSync('python3',['-c',`import time,json
DIAGNOSTICS_ENABLED=True
DIAGNOSTIC_TAB='tab';DIAGNOSTIC_TARGET=None;CURRENT_TARGET_KEY='run';BROWSER_STATE={};DIAGNOSTIC_EXPRESSION='state'
${source}
class CDP:
 def __init__(self):self.calls=0
 def command(self,*args,**kwargs):self.calls+=1;return {'result':{'value':{'focused':True}}}
c=CDP()
for stage in ['before_operation','after_operation','operation_end','before_reconnect','after_reconnect']:browser_diagnostic(c,stage)
assert c.calls==2
failed=CDP()
for stage in ['before_operation','operation_end']:browser_diagnostic(failed,stage)
assert failed.calls==2
`],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});

test('preset frame batches preserve frame scope, drain failures and forbid arbitrary scripts',()=>{
 const methods=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('    def read_commands(self,'),CLOUD_BROWSER_CONTROLLER.indexOf('    def type_keys(self,'));
 const helpers=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def frame_observation_expression('),CLOUD_BROWSER_CONTROLLER.indexOf('def set_secret_mask('));
 const run=spawnSync('python3',['-c',`import time,socket
SHADOW_HELPERS=''
${helpers}
class Transport:
${methods}
    def __init__(self):
        self.next_id=1;self.page_session='page';self.sent=[];self.replies=[];self.events=[];self.sock=self
        self.isolated_worlds={('child','frame','world',False):{'executionContextId':2},('page','main','world',False):{'executionContextId':1}}
    def settimeout(self,value):assert value>0
    def send(self,message):self.sent.append(message)
    def receive(self):
        assert len(self.sent)==2
        return self.replies.pop(0)
    def record_event(self,message):self.events.append(message)
contexts=[{'main':True,'contextId':1},{'main':False,'contextId':2,'sessionId':'child'}]
t=Transport();t.replies=[{'id':2,'result':{'result':{'value':50}}},{'method':'Page.frameDetached'},{'id':1,'result':{'result':{'value':40}}}]
assert t.frame_values('counter',contexts)==[{'value':40},{'value':50}]
assert len(t.events)==1
assert [(m['sessionId'],m['params']['contextId']) for m in t.sent]==[('page',1),('child',2)]
assert all(m['method']=='Runtime.evaluate' and m['params']['returnByValue'] for m in t.sent)
t=Transport();t.replies=[{'id':2,'error':{'message':'Cannot find context'}},{'id':1,'result':{'result':{'value':['e1']}}}]
assert t.frame_values('secret_refs',contexts,100)==[{'value':['e1']},{'error':'Cannot find context'}]
assert not t.replies and all(key[0]!='child' for key in t.isolated_worlds)
assert '__wdytRefCounter = 100' in t.sent[0]['params']['expression']
assert '__wdytRefCounter = 100' not in t.sent[1]['params']['expression']
for kind,frames in [('click',contexts),('document.body.click()',contexts),('counter',[]),('counter',contexts*33)]:
 t=Transport()
 try:t.frame_values(kind,frames)
 except RuntimeError:pass
 else:raise AssertionError('invalid operation allowed')
 assert not t.sent
for kind in ['mask_on','mask_off']:
 t=Transport();t.replies=[{'id':1,'result':{'result':{}}},{'id':2,'result':{'exceptionDetails':{'text':'frame failed'}}}]
 values=t.frame_values(kind,contexts)
 assert values==[{'value':None},{'error':'The page rejected a DOM operation'}] and not t.replies
 assert all('decision-feed-secret-mask' in m['params']['expression'] for m in t.sent)
class FailedCounter:
 def frame_values(self,*args):return [{'value':10},{'error':'Cannot find context'}]
try:frame_reference_counter(FailedCounter(),contexts)
except RuntimeError as error:assert 'Cannot find context' in str(error)
else:raise AssertionError('failed frame counter was silently omitted')
`],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});

test('existing locator reads batch fresh frames and report new identities without input',()=>{
 const methods=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('    def existing_locator_query(self,'),CLOUD_BROWSER_CONTROLLER.indexOf('    def frame_values(self,'));
 const r=spawnSync('python3',['-c',`import json
def extended_query_expression(locator,existing_only=False):
 assert existing_only is True
 assert locator=={'role':'button','name':'Continue'}
 return '__REF_COUNTER_INIT__ trusted existing-only query'
class Transport:
${methods}
    def _observation_commands(self,commands,timeout,session,settled):
     assert len(commands)==2 and settled is True
     assert all(c['method']=='Runtime.evaluate' for c in commands)
     assert all(c['params']['expression']==' trusted existing-only query' for c in commands)
     return [{'result':{'result':{'value':{'matches':[{'ref':'e1'}]}}}},{'result':{'result':{'value':{'needsRefs':True}}}}]
rows=Transport().existing_locator_query([{'contextId':1},{'contextId':2,'sessionId':'child'}],{'role':'button','name':'Continue'})
assert rows[0]['value']['matches'][0]['ref']=='e1'
assert rows[1]['value']['needsRefs'] is True
`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
