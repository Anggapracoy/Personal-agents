import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';

test('frame discovery uses child-process sessions before requesting parent worlds and excludes other tabs',()=>{
 const result=spawnSync('python3',['-c',`ns={'__name__':'test'}\nexec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)\n`+String.raw`
class CDP:
 def __init__(self): self.calls=[];self.version=0;self.frame_context_cache=None
 def command(self,method,params=None,**kwargs):
  self.calls.append((method,params,kwargs))
  if method=='Page.getFrameTree':return {'frameTree':{'frame':{'id':'main'},'childFrames':[{'frame':{'id':'local','parentId':'main'}},{'frame':{'id':'remote','parentId':'main'}}]}}
  if method=='Target.getTargets':return {'targetInfos':[{'type':'iframe','targetId':'remote','parentFrameId':'main'},{'type':'iframe','targetId':'nested','parentId':'remote'},{'type':'iframe','targetId':'unrelated','parentFrameId':'other-page'}]}
  if method=='Target.attachToTarget':return {'sessionId':params['targetId']+'-'+str(self.version)}
  if method=='Page.createIsolatedWorld':
   assert params['frameId']!='remote','Wrong-process world request would stall'
   return {'executionContextId':1 if params['frameId']=='main' else 2}
  return {}
c=CDP();contexts=ns['frame_contexts'](c)
assert [x['frameId'] for x in contexts]==['main','local','remote','nested']
assert [x['sessionId'] for x in contexts]==[None,None,'remote-0','nested-0']
assert sum(x['main'] for x in contexts)==1
assert not any(p and p.get('targetId')=='unrelated' for _,p,_ in c.calls)
count=len(c.calls);assert ns['frame_contexts'](c) is contexts and len(c.calls)==count
c.version=1;fresh=ns['frame_contexts'](c,True)
assert fresh[2]['sessionId']=='remote-1'
class Legacy(CDP):
 def command(self,method,params=None,**kwargs):
  if method=='Target.getTargets':raise RuntimeError('unsupported')
  if method=='Page.createIsolatedWorld':return {'executionContextId':3}
  return super().command(method,params,**kwargs)
assert len(ns['frame_contexts'](Legacy()))==3
class Transition(CDP):
 def command(self,method,params=None,**kwargs):
  if method=='Target.attachToTarget':raise RuntimeError('frame moved back in-process')
  if method=='Page.createIsolatedWorld':return {'executionContextId':3}
  return super().command(method,params,**kwargs)
assert [x['frameId'] for x in ns['frame_contexts'](Transition())]==['main','local','remote']
class SlowChild(Legacy):
 def command(self,method,params=None,**kwargs):
  if method=='Page.createIsolatedWorld' and params['frameId']=='remote':
   assert kwargs['timeout']==2
   raise RuntimeError('CDP command Page.createIsolatedWorld timed out')
  return super().command(method,params,**kwargs)
c=SlowChild();assert [x['frameId'] for x in ns['frame_contexts'](c)]==['main','local']
assert c.frame_context_warnings and 'unavailable' in c.frame_context_warnings[0]

class RuntimeTracked(Legacy):
 def __init__(self):super().__init__();self.live={'main','local'}
 def frame_is_live(self,frame):return frame in self.live
 def command(self,method,params=None,**kwargs):
  if method=='Page.createIsolatedWorld' and params['frameId'] not in self.live:raise AssertionError('Dead frame received renderer command')
  return super().command(method,params,**kwargs)
c=RuntimeTracked()
assert [x['frameId'] for x in ns['frame_contexts'](c)]==['main','local']
assert c.frame_context_warnings
# A later inspection recovers the child once Runtime reports its context.
c.live.add('remote')
assert [x['frameId'] for x in ns['frame_contexts'](c,True)]==['main','local','remote']
assert not c.frame_context_warnings

class LostMain(Legacy):
 def command(self,method,params=None,**kwargs):
  if method=='Page.createIsolatedWorld' and params['frameId']=='main':raise RuntimeError('CDP command Page.createIsolatedWorld timed out')
  return super().command(method,params,**kwargs)
try:ns['frame_contexts'](LostMain())
except RuntimeError as error:assert ns['observation_error_code'](error)=='connection_dropped'
else:raise AssertionError('Main-frame errors must reach read-only recovery')

`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
