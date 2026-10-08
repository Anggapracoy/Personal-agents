import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from './helpers/process';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';

test('exact refs verify their known frame, fall back when missing, and respect explicit frame scope',()=>{
 const result=spawnSync('python3',['-c',`ns={'__name__':'test'}\nexec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)\n`+String.raw`
route={'frameId':'main','contextId':1,'main':True,'sessionId':None}
class CDP:
 def reference_routes(self,ref=None,updates=None):return route
cdp=CDP();searched=[];present=True
ns['frame_contexts']=lambda *a,**kw: searched.append(True) or []
ns['evaluate_context']=lambda c,e,x: {'matches':[{'ref':'e1'}] if present else [],'nativeCandidates':False,'nextRef':1}
assert ns['extended_query_once'](cdp,{'ref':'e1'})[0]['frameId']=='main'
assert not searched, 'A valid exact ref rediscovered every frame'
present=False
assert ns['extended_query_once'](cdp,{'ref':'e1'})==[] and searched
searched.clear();present=True
assert ns['extended_query_once'](cdp,{'ref':'e1','frame':'other'})==[] and searched
assert ns['extended_query_once'](cdp,{'ref':'e1','index':1})==[]
# The hint is discarded when Chrome destroys its actual context, even when
# the context uses the default page session rather than an explicit sessionId.
real=object.__new__(ns['DirectCDP']);real.events=[];real.page_session='page';real.attached_targets={}
real.reference_routes(updates=[{'context':route,'refs':['e1']}])
assert real.reference_routes('e1')==route
real.record_event({'method':'Runtime.executionContextDestroyed','sessionId':'page','params':{'executionContextId':1}})
assert real.reference_routes('e1') is None
real.reference_routes(updates=[{'context':route,'refs':['e1']}])
real.record_event({'method':'Page.frameNavigated','sessionId':'page','params':{'frame':{'id':'main'}}})
assert real.reference_routes('e1') is None
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
