import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from './helpers/process';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';

test('passive observations omit focus logging but input operations still sample',()=>{
 const code=String.raw`import sys,json,io,contextlib
ns={'__name__':'local_test'}
exec(sys.stdin.read(),ns)
ns['DIAGNOSTICS_ENABLED']=True
calls=[]
class C:
 def command(self,*a,**k): calls.append(a[0]);return {'result':{'value':{'readyState':'complete'}}}
 def observations(self):return {}
c=C();c.passive_observation=True
with contextlib.redirect_stdout(io.StringIO()): ns['browser_diagnostic'](c,'before_operation');ns['browser_diagnostic'](c,'after_operation')
assert calls==[],calls
c.passive_observation=False
with contextlib.redirect_stdout(io.StringIO()): ns['browser_diagnostic'](c,'before_operation')
assert calls==['Runtime.evaluate'],calls
print('ok')`;
 const r=spawnSync('python3',['-c',code],{input:CLOUD_BROWSER_CONTROLLER,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('reconnect lease reuse is bounded by time, generation and verified expiry; clients always close',()=>{
 const code=String.raw`import sys
ns={'__name__':'local_test'}
exec(sys.stdin.read(),ns)
clock=[100.0];calls=[];closed=[]
class Clock:
 def time(self):return clock[0]
ns['time']=Clock()
class C:
 def command(self,name,payload): calls.append(name);return {'browserWSEndpoint':'wss://example.invalid'}
 def close(self):closed.append(True)
ns.update(BROWSER_CONNECTION=C(),BROWSER_STATE={'generation':'one'},session_remaining_ms=lambda:100000,browser_idle_deadline=lambda:clock[0]+80,json_request=lambda path:[{'id':'page','webSocketDebuggerUrl':'wss://example.invalid'}],CDP=lambda endpoint:C(),browser_diagnostic=lambda *a:None,private_json=lambda *a:None)
ns['finish_browser']();assert calls==['Browserless.reconnect'];assert len(closed)==2
clock[0]=105;ns['finish_browser']();assert len(calls)==1;assert len(closed)==3
clock[0]=111;ns['finish_browser']();assert len(calls)==2
ns['BROWSER_STATE']['generation']='two';ns['finish_browser']();assert len(calls)==3
ns['BROWSER_STATE']['reconnectLease']['expiresAt']=clock[0]+10;ns['finish_browser']();assert len(calls)==4
print('ok')`;
 const r=spawnSync('python3',['-c',code],{input:CLOUD_BROWSER_CONTROLLER,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
