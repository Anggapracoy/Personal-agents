import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from './helpers/process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
import { formatDomSnapshot } from '../lib/harness/browser/cloud';

function python(body: string) {
  const program = `import tempfile, os, json, time, io, contextlib\nns={'__name__':'offline_test'}\nexec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)\nwith tempfile.TemporaryDirectory() as root:\n ns.update(ROOT=root, TARGET_DIR=root, BROWSER_STATE_PATH=root+'/browserless.json', SECRET_KEY_DIR=root+'/keys', CURRENT_TARGET_KEY='run')\n os.environ['BROWSERLESS_API_TOKEN']='test-token'\n os.environ['BROWSERLESS_PROFILE']='dash-dev-owner'\n${body.split('\n').map(line => ' '+line).join('\n')}\n`;
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('Browserless requests advertise JSON only when sending a body', () => python(`
requests=[]
def urlopen(request, timeout):
 requests.append(request)
 if request.get_header('Content-type') == 'application/json':
  assert request.data is not None, 'empty JSON body would be rejected by Browserless'
  json.loads(request.data)
 return io.BytesIO(b'{}')
ns['urllib'].request.urlopen=urlopen
ns['browserless_api']('/profile/dash-dev-owner')
ns['browserless_api']('/browser/test', 'DELETE')
ns['browserless_api']('/stealth/bql', 'POST', {'query':'mutation { reconnect { browserWSEndpoint } }'})
ns['browserless_api']('/test', 'POST', {})
assert [request.get_method() for request in requests] == ['GET','DELETE','POST','POST']
assert all(request.data is None and request.get_header('Content-type') is None for request in requests[:2])
assert all(request.get_header('Content-type') == 'application/json' for request in requests[2:])
`));

test('expired reads and writes never create a paid browser or replay actions', () => python(`
calls=[]
ns['browserless_api']=lambda *args: calls.append(args)
for operation in ['snapshot','click','secure_type','screenshot','live_url','solve_captcha','recover_target','user_wait']:
 try: ns['connect_browser']({'operation':operation})
 except RuntimeError as error: assert 'not running' in str(error)
 else: raise AssertionError(operation)
assert calls==[]
`));

test('fresh navigation restores only the server-selected account profile and invalidates recipients', () => python(`
calls=[]
class CDP:
 def __init__(self,url): self.url=url
ns['CDP']=CDP
os.makedirs(ns['SECRET_KEY_DIR'])
open(ns['SECRET_KEY_DIR']+'/old.pem','w').close()
def api(path, method='GET', body=None):
 calls.append((path,method,body))
 if path.startswith('/profile/'): return {'name':'dash-dev-owner'}
 return {'data':{'reconnect':{'browserWSEndpoint':'wss://production-sfo.browserless.io/reconnect/session'}}}
ns['browserless_api']=api
ns['connect_browser']({'operation':'navigate'})
assert calls[0][0]=='/profile/dash-dev-owner'
assert 'profile=dash-dev-owner' in calls[1][0]
assert 'proxy=residential' in calls[1][0]
assert 'timeout=1800000' in calls[1][0]
assert 1790000 < ns['session_remaining_ms']() <= 1800000
assert os.listdir(ns['SECRET_KEY_DIR'])==[]
assert os.stat(ns['BROWSER_STATE_PATH']).st_mode & 0o777 == 0o600
# Configurations above the plan limit are capped at thirty minutes too.
os.remove(ns['BROWSER_STATE_PATH'])
ns['BROWSER_STATE']={}
ns['BROWSER_CONNECTION']=None
os.environ['BROWSERLESS_SESSION_TIMEOUT_MS']='3600000'
calls.clear()
ns['connect_browser']({'operation':'navigate'})
assert 'timeout=1800000' in calls[1][0]
os.environ.pop('BROWSERLESS_SESSION_TIMEOUT_MS')
`));

test('remote endpoint validation prevents credential forwarding to other hosts', () => python(`
for url in ['wss://attacker.test/','http://production-sfo.browserless.io/','wss://production-sfo.browserless.io.attacker.test/','wss://user@production-sfo.browserless.io/','wss://production-sfo.browserless.io:444/']:
 try: ns['browserless_url'](url)
 except RuntimeError: pass
 else: raise AssertionError(url)
assert ns['browserless_url']('wss://production-sfo.browserless.io/reconnect/x?token=old').endswith('token=test-token')
`));

test('missing run targets never adopt another tab on an inspection', () => python(`
ns['json_request']=lambda *args: [{'id':'other','type':'page','webSocketDebuggerUrl':'wss://example'}]
try: ns['choose_target']('run',False)
except RuntimeError as error: assert 'no live browser tab' in str(error)
else: raise AssertionError('adopted unrelated tab')
`));

test('vault recipients cannot be rebound after tab recovery or session replacement', () => python(`
ns['BROWSER_STATE']={'generation':'original'}
path=ns['target_path']('run')
with open(path,'w') as handle: handle.write('tab-one')
token='a'*32
ns['secret_recipient'](token)
with open(path,'w') as handle: handle.write('tab-two')
for invoke in [lambda:ns['secret_recipient'](token),lambda:ns['decrypt_device_envelope'](None,token,{})]:
 try: invoke()
 except RuntimeError as error: assert 'different browser' in str(error)
 else: raise AssertionError('rebound recipient')
`));

test('takeover blocks agent mutations before they reach the page', () => python(`
calls=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,*args,**kwargs): calls.append(method); return {}
 def close(self): pass
ns['CDP']=CDP
ns['BROWSER_STATE']={'live':{'run':{'control':True,'expiresAt':time.time()+60}}}
try: ns['execute_request']({'operation':'click','payload':{'ref':'e1'}},{'id':'tab','webSocketDebuggerUrl':'unused'})
except RuntimeError as error: assert 'user is controlling' in str(error)
else: raise AssertionError('mutation allowed')
assert calls==['Page.enable','Runtime.enable']
`));

test('watch streams last for the browser session while takeover keeps its bounded lease', () => python(`
calls=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,**kwargs):
  calls.append((method,params))
  if method=='Browserless.liveURL': return {'liveURLId':'stream','liveURL':'https://production-sfo.browserless.io/live/stream'}
  return {}
 def close(self): pass
ns['CDP']=CDP
for control,remaining,expected in [(False,900000,899000),(True,900000,600000),(False,45000,44000),(True,45000,44000)]:
 ns['BROWSER_STATE']={}
 ns['session_remaining_ms']=lambda:remaining
 calls.clear()
 with contextlib.redirect_stdout(io.StringIO()) as output:
  ns['execute_request']({'operation':'live_url','payload':{'control':control}},{'id':'tab','webSocketDebuggerUrl':'unused'})
 assert json.loads(output.getvalue())['ok']
 options=next(params for method,params in calls if method=='Browserless.liveURL')
 assert options['timeout']==expected,options
 assert options['interactable']==control
 focus=[params for method,params in calls if method=='Emulation.setFocusEmulationEnabled']
 assert focus==([{'enabled':False}] if control else [])
 assert not any(method=='Page.navigate' for method,params in calls)
 # Reopening the viewer reuses the lease without resetting its deadline.
 calls.clear()
 with contextlib.redirect_stdout(io.StringIO()):
  ns['execute_request']({'operation':'live_url','payload':{'control':control}},{'id':'tab','webSocketDebuggerUrl':'unused'})
 assert not any(method=='Browserless.liveURL' for method,params in calls)
`));

test('a replaced viewer creator remints only the stream and preserves the takeover deadline', () => python(`
calls=[]
class CDP:
 def __init__(self,url): pass
 def transport_identity(self): return {'key':'page','token':'new'}
 def command(self,method,params=None,**kwargs):
  calls.append((method,params))
  if method=='Browserless.liveURL': return {'liveURLId':'new-stream','liveURL':'https://production-sfo.browserless.io/live/new-stream'}
  return {}
 def close(self): pass
ns['CDP']=CDP
ns['hide_visual_cursor']=lambda cdp: None
ns['session_remaining_ms']=lambda:900000
ns['BROWSER_STATE']={'live':{'run':{'id':'old','url':'old','control':True,'expiresAt':time.time()+60,'transport':{'key':'page','token':'old'}}}}
with contextlib.redirect_stdout(io.StringIO()):
 ns['execute_request']({'operation':'live_url','payload':{'control':True}},{'id':'tab','webSocketDebuggerUrl':'unused'})
assert [method for method,_ in calls]==['Page.enable','Runtime.enable','Emulation.setFocusEmulationEnabled','Browserless.closeLiveURL','Browserless.liveURL'], calls
assert 58000 < calls[-1][1]['timeout'] <= 60000
assert ns['BROWSER_STATE']['live']['run']['transport']['token']=='new'
`));

test('solver is bounded and returns no third-party token', () => python(`
calls=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,*args,**kwargs):
  calls.append(method)
  return {'captchaFound':True,'solved':True,'token':'private-solver-token'}
 def close(self): pass
ns['CDP']=CDP
ns['snapshot']=lambda cdp: {'text':'Ready'}
ns['checkpoint_profile']=lambda *args: None
capture=io.StringIO()
with contextlib.redirect_stdout(capture):
 ns['execute_request']({'operation':'solve_captcha'},{'id':'tab','webSocketDebuggerUrl':'unused'})
assert 'private-solver-token' not in capture.getvalue()
assert json.loads(capture.getvalue())['value']['solved'] is True
try: ns['execute_request']({'operation':'solve_captcha'},{'id':'tab','webSocketDebuggerUrl':'unused'})
except RuntimeError as error: assert 'already attempted' in str(error)
else: raise AssertionError('repeated paid solver')
assert calls.count('Browserless.solveCaptcha')==1
`));

test('background save failures remain visible without saving during a read', () => python(`
class CDP:
 def __init__(self,url): pass
 def command(self,*args,**kwargs): return {}
 def close(self): pass
ns['CDP']=CDP
ns['snapshot']=lambda cdp: {'text':'Ready'}
def fail(*args): raise RuntimeError('upstream failure')
ns['checkpoint_profile']=fail
ns['BROWSER_STATE']={'generation':'test'}
ns['private_json'](ns['profile_file']('status'),{'generation':'test','errorCode':'profile_partial_save'})
capture=io.StringIO()
with contextlib.redirect_stdout(capture): ns['execute_request']({'operation':'snapshot'},{'id':'tab','webSocketDebuggerUrl':'unused'})
value=json.loads(capture.getvalue())
assert value['ok'] and 'persistenceWarning' in value['value']
assert not os.path.exists(ns['profile_file']('pending'))
`));

test('profile persistence warnings remain visible in model snapshots', () => {
  assert.match(formatDomSnapshot({ persistenceWarning: 'Login state could not be saved.' }), /Login state could not be saved/);
});

test('passive browser observations never resize the viewport', () => python(`
calls=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,*args,**kwargs): calls.append((method,params)); return {}
 def close(self): pass
ns['CDP']=CDP
ns['snapshot']=lambda cdp: {'text':'Ready'}
ns['checkpoint_profile']=lambda *args: None
for takeover in [False,True]:
 calls.clear()
 ns['BROWSER_STATE']={'live':{'run':{'control':takeover,'expiresAt':time.time()+60}}}
 with contextlib.redirect_stdout(io.StringIO()):
  ns['execute_request']({'operation':'snapshot'},{'id':'tab','webSocketDebuggerUrl':'unused'})
 metrics=[params for method,params in calls if method=='Emulation.setDeviceMetricsOverride']
 assert metrics == []
 assert not any(method=='Emulation.setFocusEmulationEnabled' for method,params in calls)
`));


test('screenshot mask targets only fields marked by secure typing', () => python(`
expressions=[]
ns['frame_contexts']=lambda cdp: [{'main':True}]
ns['evaluate_context']=lambda cdp,expression,context: expressions.append(expression)
ns['set_secret_mask'](None,True)
expression=expressions[0]
assert 'data-decision-feed-secret' in expression
assert 'autocomplete' not in expression
assert 'input[type=password]' not in expression
assert 'input:not(' not in expression
assert ',textarea' not in expression
assert ',[contenteditable=' not in expression
ns['set_secret_mask'](None,False)
assert 'remove()' in expressions[-1]
`));

test('private CDP pool preserves sessions across clients without replaying failed writes', () => python(`
import threading
created=[]
closed=[]
writes=[]
class Direct:
 def __init__(self,endpoint):
  self.identity=len(created)+1
  created.append(endpoint)
 def command(self,method,params=None,**kwargs):
  if method=='provider-complete': self.live_url_epoch=getattr(self,'live_url_epoch',0)+1
  if method=='visual-timeout': raise RuntimeError('CDP command Runtime.evaluate timed out')
  if method=='Page.createIsolatedWorld': raise RuntimeError('CDP command Page.createIsolatedWorld timed out')
  if method=='Input.dispatchMouseEvent':
   writes.append(self.identity)
   raise RuntimeError('CDP command Input.dispatchMouseEvent timed out')
  if method=='write':
   writes.append(self.identity)
   raise RuntimeError('uncertain write')
  return {'identity':self.identity}
 def close(self): closed.append(self.identity)
 def poll_idle(self): pass
 def clear_events(self): pass
 def take_events(self): return []
 def pump_events(self,timeout): pass
ns['DirectCDP']=Direct
ns['BROWSER_STATE']={'generation':'first','expiresAt':time.time()+10,'live':{}}
thread=threading.Thread(target=ns['serve_cdp_pool'],daemon=True)
thread.start()
for attempt in range(100):
 # bind creates the socket before the server tightens its mode and listens.
 if os.path.exists(ns['cdp_pool_path']()) and os.stat(ns['cdp_pool_path']()).st_mode & 0o777 == 0o600: break
 time.sleep(.01)
assert os.stat(ns['cdp_pool_path']()).st_mode & 0o777 == 0o600
endpoint='wss://production-sfo.browserless.io/reconnect/first#tab-one'
first=ns['PooledCDP'](endpoint)
assert first.command('read')=={'identity':1}
identity=first.transport_identity()
assert json.load(open(root+'/cdp-health.json'))[identity['key']]==identity['token']
first.close()
second=ns['PooledCDP'](endpoint.replace('/first','/renewed'))
assert second.command('read')=={'identity':1}
assert len(created)==1 and closed==[]
try: second.command('Page.createIsolatedWorld',{'frameId':'child'},timeout=2)
except RuntimeError as error: assert 'timed out' in str(error)
else: raise AssertionError('Expected bounded child-world timeout')
assert second.command('read')=={'identity':1}
assert len(created)==1 and closed==[], 'A bounded world read discarded the input connection'
try: second.command('write')
except RuntimeError as error: assert 'uncertain write' in str(error)
else: raise AssertionError('write failure hidden')
assert writes==[1]
try: second.command('Input.dispatchMouseEvent',{'type':'mouseReleased'})
except RuntimeError as error: assert 'timed out' in str(error)
else: raise AssertionError('Input timeout was hidden')
assert writes==[1,1], 'Timed-out input was replayed'
assert second.command('read')=={'identity':1}, 'Input timeout discarded a live socket'
assert len(created)==1 and closed==[]
other=ns['PooledCDP'](endpoint.replace('tab-one','tab-two'))
assert other.command('read')=={'identity':2}
visual=ns['PooledCDP'](endpoint,channel='visual')
assert visual.command('read')=={'identity':3}
visual_identity=visual.transport_identity()
assert ns['PooledCDP'](endpoint,channel='visual').command('read')=={'identity':3}
try: visual.command('visual-timeout')
except RuntimeError: pass
else: raise AssertionError('visual timeout expected')
assert visual_identity['key'] not in json.load(open(root+'/cdp-health.json'))
assert json.load(open(root+'/cdp-health.json'))[identity['key']]==identity['token']
assert second.command('read')=={'identity':1}, 'decoration discarded the action connection'
assert other.command('read')=={'identity':2}
assert ns['PooledCDP'](endpoint,channel='visual').command('read')=={'identity':4}
diagnostic=ns['PooledCDP'](endpoint,channel='diagnostic')
assert diagnostic.command('read')=={'identity':5}
try:diagnostic.command('visual-timeout')
except RuntimeError:pass
else:raise AssertionError('diagnostic timeout expected')
assert second.command('read')=={'identity':1}, 'diagnostic discarded input'
viewer=ns['PooledCDP'](endpoint,channel='viewer')
assert viewer.command('read')=={'identity':6}
viewer_identity=viewer.transport_identity()
assert viewer_identity['key']!=identity['key']
assert ns['PooledCDP'](endpoint.replace('/first','/renewed'),channel='viewer').transport_identity()==viewer_identity
assert second.command('read')=={'identity':1}
assert viewer.transport_identity()==viewer_identity
viewer.command('provider-complete')
completed=viewer.transport_identity()
assert completed['token']!=viewer_identity['token']
assert json.load(open(root+'/cdp-health.json'))[completed['key']]==completed['token']
assert second.command('read')=={'identity':1}
second.command('Browser.close')
thread.join(2)
assert not thread.is_alive()
assert json.load(open(root+'/cdp-health.json'))=={}
assert sorted(closed)==[1,2,3,4,5,6]
assert not os.path.exists(ns['cdp_pool_path']())
`));

test('busy idle transports yield to queued tool commands and each connection gets serviced', () => python(`
import threading
entered=threading.Event()
serviced=set()
class Direct:
 def __init__(self,endpoint):self.endpoint=endpoint
 def command(self,method,params=None,**kwargs):return {'ok':True}
 def close(self):pass
 def poll_idle(self):
  serviced.add(self.endpoint)
  entered.set()
  time.sleep(.01)
  return True
ns['DirectCDP']=Direct
ns['BROWSER_STATE']={'generation':'idle-test','expiresAt':time.time()+10,'live':{}}
thread=threading.Thread(target=ns['serve_cdp_pool'],daemon=True);thread.start()
for attempt in range(100):
 if os.path.exists(ns['cdp_pool_path']()):break
 time.sleep(.01)
pages=[ns['PooledCDP']('wss://production-sfo.browserless.io/reconnect/test#tab-'+str(i)) for i in range(4)]
assert entered.wait(2)
started=time.monotonic()
assert pages[0].command('read')=={'ok':True}
elapsed=time.monotonic()-started
assert elapsed<.2, ('Idle maintenance blocked command',elapsed)
deadline=time.monotonic()+3
while len(serviced)<4 and time.monotonic()<deadline:time.sleep(.01)
assert len(serviced)==4,serviced
pages[0].command('Browser.close');thread.join(2)
assert not thread.is_alive()
`));

test('CDP pool idle cleanup honors takeover and the browser deadline', () => python(`
import threading
closed=[]
class Direct:
 def __init__(self,endpoint): pass
 def command(self,method,*args,**kwargs):
  if method=='Browser.close': closed.append('browser')
  return {}
 def close(self): closed.append('socket')
 def poll_idle(self): pass
ns['DirectCDP']=Direct
now=time.time()
ns['BROWSER_STATE']={'generation':'idle','expiresAt':now+600,'live':{}}
assert now+119 <= ns['cdp_pool_metadata']()['idleUntil'] <= now+121
ns['BROWSER_STATE']['live']={'run':{'control':True,'expiresAt':now+500}}
assert ns['cdp_pool_metadata']()['idleUntil']==ns['BROWSER_STATE']['expiresAt']
ns['BROWSER_STATE']['expiresAt']=time.time()+.5
thread=threading.Thread(target=ns['serve_cdp_pool'],daemon=True)
thread.start()
for attempt in range(100):
 # bind creates the socket before the server tightens its mode and listens.
 if os.path.exists(ns['cdp_pool_path']()) and os.stat(ns['cdp_pool_path']()).st_mode & 0o777 == 0o600: break
 time.sleep(.01)
ns['PooledCDP']('wss://production-sfo.browserless.io/reconnect/test#tab')
thread.join(2)
assert not thread.is_alive()
assert closed==['browser','socket']
`));

test('persistent frame attachments are reused until Chrome detaches them', () => python(`
cdp=object.__new__(ns['DirectCDP'])
cdp.next_id=1
cdp.events=[]
cdp.page_session=None
cdp.attached_targets={}
class Socket:
 def settimeout(self,*args): pass
cdp.sock=Socket()
sent=[]
cdp.send=lambda message: sent.append(message)
cdp.receive=lambda: {'id':sent[-1]['id'],'result':{'sessionId':'session-'+str(len(sent))}}
first=cdp.command('Target.attachToTarget',{'targetId':'frame','flatten':True})
assert cdp.command('Target.attachToTarget',{'targetId':'frame','flatten':True})==first
assert len(sent)==1
cdp.record_event({'method':'Target.detachedFromTarget','params':first})
assert cdp.command('Target.attachToTarget',{'targetId':'frame','flatten':True})!=first
assert len(sent)==2
`));

test('secure typing executes only the chosen login or card field and never advances', () => python(`
commands=[]
filled=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,*args,**kwargs): commands.append(method); return {}
 def close(self): pass
ns['CDP']=CDP
ns['checkpoint_profile']=lambda *args: None
ns['snapshot']=lambda cdp: {'url':'https://test.example/form','text':'Form still open'}
ns['evaluate']=lambda cdp,expression,*args: 'https://test.example/form'
ns['assert_secure_target']=lambda cdp,ref: None
ns['focus_secure_target']=lambda cdp,ref: None
ns['mark_secure_target']=lambda cdp,ref: None
ns['decrypt_device_envelope']=lambda *args: {'kind':kind,'username':'user','password':'pass','cardNumber':'4111111111111111','expiryMonth':'12','expiryYear':'2030','securityCode':'123'}
ns['replace_secure_field_text']=lambda cdp,ref,name,text: filled.append((ref,name,text))
ns['secure_field_state']=lambda cdp,ref: {'value':filled[-1][2],'valid':True}
token='a'*32
private_path=ns['secret_key_path'](token)
def call(payload):
 with contextlib.redirect_stdout(io.StringIO()) as output:
  ns['execute_request']({'operation':'secure_fill_envelope','payload':{'token':token,'kind':kind,'envelope':{},'expectedUrl':'https://test.example/form',**payload}}, {'id':'tab','webSocketDebuggerUrl':'unused'})
 return json.loads(output.getvalue())['value']
for kind,name,ref in [('login','username','e2'),('login','password','e3'),('payment_card','cardNumber','e7'),('payment_card','expiry','e8'),('payment_card','securityCode','e9')]:
 open(private_path,'w').write('test-key')
 before=len(filled)
 result=call({'fields':[{'name':name,'ref':ref}], 'retainForSecureTyping':True})
 assert len(filled)==before+1 and filled[-1][:2]==(ref,name)
 assert result['secureFieldNames']==[name] and result['secureFieldsVerified']
 assert os.path.exists(private_path)
assert not any(method.startswith('Input.') or method=='Page.navigate' for method in commands), commands
before=len(filled)
for payload in [{'fields':[]}, {'fields':[{'name':'username','ref':'e1'},{'name':'password','ref':'e2'}]}, {'fields':[{'name':'cardNumber','ref':'e7'}],'autoDiscover':True}, {'fields':[{'name':'cardNumber','ref':'e7'}],'autoAdvanceLogin':True}]:
 try: call(payload)
 except RuntimeError as error: assert 'exactly one' in str(error)
 else: raise AssertionError('accepted implicit or multiple targets')
 assert len(filled)==before
for origin,created in [('https://other.example',time.time())]:
 ns['private_json'](private_path+'.lease',{'origin':origin,'createdAt':created})
 try: call({'fields':[{'name':'cardNumber','ref':'e7'}]})
 except RuntimeError as error: assert 'expired or belongs to another origin' in str(error)
 else: raise AssertionError('accepted invalid release scope')
 assert len(filled)==before
open(private_path,'w').write('test-key')
ns['private_json'](private_path+'.lease',{'origin':'https://test.example','createdAt':time.time()-3600})
assert call({'fields':[{'name':'securityCode','ref':'e9'}], 'retainForSecureTyping':True})['secureFieldsVerified']
`));

test('secure CVC typing recovers transient page-focus loss using the same unlock', () => python(`
commands=[]
filled=[]
focus_calls=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,*args,**kwargs): commands.append(method); return {}
 def close(self): pass
ns['CDP']=CDP
ns['checkpoint_profile']=lambda *args: None
ns['snapshot']=lambda cdp: {'url':'https://test.example/checkout','text':'Checkout'}
ns['evaluate']=lambda cdp,expression,*args: 'https://test.example/checkout'
def focus(cdp,ref):
 focus_calls.append(ref)
 if len(focus_calls)==1: raise ns['SecureTargetFocusLost']('The selected secure field lost page focus before typing')
ns['focus_secure_target']=focus
ns['mark_secure_target']=lambda cdp,ref: None
ns['decrypt_device_envelope']=lambda *args: {'kind':'payment_card','securityCode':'123'}
def replace(cdp,ref,name,value):
 if not filled: filled.append('focus_lost'); raise ns['SecureTargetFocusLost']('The selected secure field lost page focus before typing')
 filled.append((ref,name,value))
ns['replace_secure_field_text']=replace
ns['secure_field_state']=lambda cdp,ref: {'value':'123','semanticValidity':'valid'}
token='a'*32
private_path=ns['secret_key_path'](token)
open(private_path,'w').write('test-key')
with contextlib.redirect_stdout(io.StringIO()) as output:
 ns['execute_request']({'operation':'secure_fill_envelope','payload':{'token':token,'kind':'payment_card','envelope':{},'expectedUrl':'https://test.example/checkout','fields':[{'name':'securityCode','ref':'e9'}],'retainForSecureTyping':True}}, {'id':'tab','webSocketDebuggerUrl':'unused'})
result=json.loads(output.getvalue())['value']
assert result['secureFieldsVerified'] and result['secureFieldNames']==['securityCode']
assert focus_calls==['e9','e9','e9']
assert filled==['focus_lost',('e9','securityCode','123')]
assert commands.count('Page.bringToFront')>=2
assert os.path.exists(private_path)
`));

test('a persistent CVC focus interruption keeps its release for a later same-run retry', () => python(`
commands=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,*args,**kwargs): commands.append(method); return {}
 def close(self): pass
ns['CDP']=CDP
ns['checkpoint_profile']=lambda *args: None
ns['snapshot']=lambda cdp: {'url':'https://test.example/checkout','text':'Checkout'}
ns['evaluate']=lambda cdp,expression,*args: 'https://test.example/checkout'
ns['mark_secure_target']=lambda cdp,ref: None
ns['decrypt_device_envelope']=lambda *args: {'kind':'payment_card','securityCode':'123'}
ns['replace_secure_field_text']=lambda cdp,ref,name,value: None
ns['secure_field_state']=lambda cdp,ref: {'value':'123','semanticValidity':'valid'}
focus_lost=True
def focus(cdp,ref):
 if focus_lost: raise ns['SecureTargetFocusLost']('The selected secure field lost page focus before typing')
ns['focus_secure_target']=focus
token='a'*32
private_path=ns['secret_key_path'](token)
open(private_path,'w').write('test-key')
payload={'token':token,'kind':'payment_card','envelope':{},'expectedUrl':'https://test.example/checkout','fields':[{'name':'securityCode','ref':'e9'}],'retainForSecureTyping':True}
try: ns['execute_request']({'operation':'secure_fill_envelope','payload':payload}, {'id':'tab','webSocketDebuggerUrl':'unused'})
except ns['SecureTargetFocusLost']: pass
else: raise AssertionError('typed despite persistent focus loss')
assert os.path.exists(private_path)
focus_lost=False
with contextlib.redirect_stdout(io.StringIO()) as output:
 ns['execute_request']({'operation':'secure_fill_envelope','payload':payload}, {'id':'tab','webSocketDebuggerUrl':'unused'})
assert json.loads(output.getvalue())['value']['secureFieldsVerified']
assert os.path.exists(private_path)
`));

test('secure typing refuses lost focus without clicking or refocusing another field', () => python(`
commands=[]
focused=True
ns['describe']=lambda *args: {'contextId':1,'mainFrame':True}
ns['evaluate']=lambda *args: focused
class CDP:
 def command(self,method,params=None,*args,**kwargs):
  global focused
  commands.append((method,params))
  if params.get('text'): focused=False
cdp=CDP()
try: ns['replace_field_text'](cdp,'e1','secret',require_focused=True)
except RuntimeError as error: assert 'focus changed' in str(error)
else: raise AssertionError('typed after focus changed')
assert [params['text'] for _,params in commands if params.get('text')]==['s']
assert not any(method=='Input.dispatchMouseEvent' for method,_ in commands)
commands.clear()
try: ns['replace_field_text'](cdp,'e1','secret',require_focused=True)
except RuntimeError: pass
else: raise AssertionError('accepted unfocused input')
assert commands==[]
`));

test('secure field selection loss is recoverable but noneditable targets are not', () => python(`
ns['describe']=lambda *args: {'contextId':1,'mainFrame':True}
state={'editable':True,'focused':True,'pageFocused':False,'disabled':False,'readOnly':False}
ns['evaluate']=lambda cdp,expression,*args: state if 'return {ref:' in expression else False
try: ns['assert_secure_target'](object(),'e9')
except ns['SecureTargetFocusLost']: pass
else: raise AssertionError('missed background-page focus loss')
state['focused']=False
try: ns['assert_secure_target'](object(),'e9')
except ns['SecureTargetFocusLost']: pass
else: raise AssertionError('selection loss must retain the unlock for refocusing')
state['editable']=False
try: ns['assert_secure_target'](object(),'e9')
except RuntimeError as error: assert type(error) is RuntimeError
else: raise AssertionError('accepted noneditable target')
`));

test('an explicit click on a hosted field uses that iframe input session', () => python(`
commands=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,*args,**kwargs): commands.append((method,params,kwargs)); return {}
 def close(self): pass
ns['CDP']=CDP
ns['describe']=lambda *args: {'contextId':7,'mainFrame':False,'sessionId':'hosted-input','x':20,'y':30}
ns['assert_frame_uncovered']=lambda *args: None
ns['wait_for_input_ready']=lambda cdp,ref,**kwargs: ns['describe'](cdp,ref)
ns['evaluate']=lambda *args: True
ns['snapshot']=lambda *args: {'text':'Card fields'}
ns['ready']=lambda *args: None
ns['checkpoint_profile']=lambda *args: None
with contextlib.redirect_stdout(io.StringIO()):
 ns['execute_request']({'operation':'click','payload':{'ref':'e7'}},{'id':'tab','webSocketDebuggerUrl':'unused'})
mouse=[(params['type'],kwargs.get('session_id')) for method,params,kwargs in commands if method=='Input.dispatchMouseEvent']
assert mouse==[('mousePressed','hosted-input'),('mouseReleased','hosted-input')]
`));

test('hosted-field recovery respects active user takeover and contains site errors', () => python(`
calls=[]
ns['evaluate']=lambda *args: calls.append(args) or {'attempted':True}
ns['BROWSER_STATE']={'live':{'run':{'control':True,'expiresAt':time.time()+60}}}
assert ns['recover_missing_hosted_fields'](None) is None
assert calls==[]
ns['BROWSER_STATE']['live']['run']['expiresAt']=time.time()-1
assert ns['recover_missing_hosted_fields'](None)=={'attempted':True}
assert len(calls)==1
def rejected(*args): raise RuntimeError('site changed during navigation')
ns['evaluate']=rejected
assert ns['recover_missing_hosted_fields'](None) is None
`));

test('cursor rendering failure cannot block or duplicate a real click', () => python(`
commands=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,*args,**kwargs):
  commands.append((method,params))
  if method=='Page.createIsolatedWorld': raise RuntimeError('decorative script unavailable')
  return {}
 def close(self): pass
ns['CDP']=CDP
def describe(cdp,ref):
 cdp.frame_context_cache=[{'frameId':'main','main':True,'contextId':7}]
 return {'frameId':'main','contextId':7,'mainFrame':True,'x':20,'y':30}
ns['describe']=describe
ns['wait_for_input_ready']=lambda cdp,ref,**kwargs: describe(cdp,ref)
ns['snapshot']=lambda *args: {'text':'Checkout'}
ns['ready']=lambda *args: None
ns['checkpoint_profile']=lambda *args: None
with contextlib.redirect_stdout(io.StringIO()):
 ns['execute_request']({'operation':'click','payload':{'ref':'e7'}},{'id':'tab','webSocketDebuggerUrl':'unused'})
assert any(method=='Page.createIsolatedWorld' for method,params in commands)
mouse=[params['type'] for method,params in commands if method=='Input.dispatchMouseEvent']
assert mouse==['mousePressed','mouseReleased']
`));

test('cursor maps nested hosted-field coordinates without scrolling or hit tests', () => python(`
calls=[]
class CursorCDP:
 endpoint='test-tab'
 frame_context_cache=[{'frameId':'main','main':True,'contextId':1},{'frameId':'outer','parentFrameId':'main','contextId':2},{'frameId':'inner','parentFrameId':'outer','contextId':3,'sessionId':'oopif'}]
 def command(self,method,params=None,*args,**kwargs):
  calls.append((method,params))
  if method=='Page.createIsolatedWorld': return {'executionContextId':1}
  if method=='Page.addScriptToEvaluateOnNewDocument': return {'identifier':'restore-1'}
  if method=='DOM.getFrameOwner': return {'backendNodeId':9}
  if method=='DOM.resolveNode': return {'object':{'objectId':'owner'}}
  if method=='Runtime.callFunctionOn':
   p=params['arguments'][0]['value']
   assert 'scroll' not in params['functionDeclaration'] and 'elementFromPoint' not in params['functionDeclaration']
   return {'result':{'value':{'x':p['x']+100,'y':p['y']+50}}}
  return {}
ns['cursor_transport']=lambda cdp: cdp
ns['visual_cursor'](CursorCDP(),{'frameId':'inner','x':10,'y':20})
render=[params for method,params in calls if method=='Runtime.evaluate']
assert len(render)==1 and render[0]['contextId']==1
assert '"x": 210' in render[0]['expression'] and '"y": 120' in render[0]['expression']
assert ns['BROWSER_STATE']['cursorScripts']['test-tab']=='restore-1'
ns['hide_visual_cursor'](CursorCDP())
assert ns['BROWSER_STATE']['cursorScripts']=={}
assert ('Page.removeScriptToEvaluateOnNewDocument',{'identifier':'restore-1'}) in calls
assert calls[-1][0]=='Runtime.evaluate' and '.remove()' in calls[-1][1]['expression']
`));

test('user waits retain existing task tabs for ten minutes without sliding or affecting other tasks', () => python(`
now=1000
ns['time'].time=lambda: now
ns['BROWSER_STATE']={'generation':'waiting','expiresAt':1900,'live':{}}
ns['json_request']=lambda path: [{'id':'tab-a'},{'id':'tab-b'}]
open(ns['target_path']('a'),'w').write('tab-a')
open(ns['target_path']('b'),'w').write('tab-b')
assert ns['set_user_wait']('a',True)['waitingUntil']==1600
assert ns['cdp_pool_metadata']()['idleUntil']==1600
now=1050
assert ns['set_user_wait']('a',True)['waitingUntil']==1600
assert ns['set_user_wait']('b',True)['waitingUntil']==1650
ns['set_user_wait']('a',False)
assert ns['cdp_pool_metadata']()['idleUntil']==1650
ns['set_user_wait']('b',False)
assert ns['cdp_pool_metadata']()['idleUntil']==1170
assert ns['set_user_wait']('no-tab',True)['waitingUntil'] is None
ns['BROWSER_STATE']['expiresAt']=1100
assert ns['set_user_wait']('a',True)['waitingUntil']==1100
assert ns['cdp_pool_metadata']()['idleUntil']==1100
`));

test('remote reconnect uses the same bounded user-wait lease as the CDP worker', () => python(`
now=1000
ns['time'].time=lambda: now
calls=[]
class CDP:
 def __init__(self,*args): pass
 def command(self,method,args=None):
  calls.append((method,args))
  return {}
 def close(self): pass
ns['CDP']=CDP
ns['BROWSER_CONNECTION']=CDP()
ns['json_request']=lambda path: [{'webSocketDebuggerUrl':'test'}]
for waits,expires,expected in [({},1900,120000),({'run':1600},1900,600000),({'run':1600},1300,300000),({'run':900},1900,120000)]:
 ns['BROWSER_STATE']={'expiresAt':expires,'userWaits':waits}
 ns['finish_browser']()
 assert calls[-1]==('Browserless.reconnect',{'timeout':expected}), calls[-1]
`));

test('typing removes the cursor before input for regular and secure fields', () => python(`
for secure in (False, True):
 for strategy in ('keys', 'insert'):
  events=[]
  element={'contextId':1,'mainFrame':True,'x':20,'y':30}
  ns['describe']=lambda *args: element
  ns['wait_for_input_ready']=lambda *args,**kwargs: events.append('ready') or element
  ns['assert_secure_target']=lambda *args: element
  ns['evaluate']=lambda *args: True
  ns['visual_cursor']=lambda *args,**kwargs: events.append('pointer')
  ns['hide_visual_cursor']=lambda *args,**kwargs: events.append('removed')
  class CDP:
   def command(self,method,*args,**kwargs): events.append(method)
  ns['replace_field_text'](CDP(),'e1','hello',strategy,require_focused=secure)
  first_input=next(i for i,event in enumerate(events) if event in ('Input.dispatchKeyEvent','Input.insertText'))
  assert events.index('removed') < first_input
  assert 'pointer' not in events[first_input:]
  assert ('ready' in events) is (not secure)
  if not secure: assert events.index('ready') < events.index('Input.dispatchMouseEvent')
`));

test('screenshots preserve live cursor visibility while retaining secret masking', () => python(`
events=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,*args,**kwargs):
  events.append(method)
  return {'data':'aW1hZ2U='} if method=='Page.captureScreenshot' else {}
 def close(self): pass
ns['CDP']=CDP
ns['browser_diagnostic']=lambda *args: None
ns['set_secret_mask']=lambda cdp,enabled: events.append(('mask',enabled))
def no_cursor_toggle(*args,**kwargs): raise AssertionError('Screenshot must not blink the live cursor')
ns['hide_visual_cursor']=no_cursor_toggle
with contextlib.redirect_stdout(io.StringIO()):
 ns['execute_request']({'operation':'screenshot','payload':{'path':root+'/screenshot-test.png'}},{'id':'tab','webSocketDebuggerUrl':'unused'})
assert events.index(('mask',True)) < events.index('Page.captureScreenshot') < events.index(('mask',False))
assert open(root+'/screenshot-test.png','rb').read()==b'image'
events.clear()
out=io.StringIO()
with contextlib.redirect_stdout(out):
 ns['execute_request']({'operation':'screenshot','payload':{'inline':True}},{'id':'tab','webSocketDebuggerUrl':'unused'})
assert json.loads(out.getvalue())['value']['base64']=='aW1hZ2U='
assert events.index(('mask',True)) < events.index('Page.captureScreenshot') < events.index(('mask',False))

`));

test('profile capture reads storage without viewport mutations and retains unopened origins', () => python(`
closed={'origin':'https://previous.test','localStorage':{'auth':'preserved'}}
old={'origin':'https://current.test','localStorage':{'deleted':'old'}}
fresh={'origin':'https://current.test','localStorage':{},'indexedDBs':[]}
ns['BROWSER_STATE']={'profileExists':True}
ns['browserless_api']=lambda *args: {'origins':[closed,old], 'cookies':[{'name':'deleted'}]}
ns['json_request']=lambda *args: [{'webSocketDebuggerUrl':'first'}, {'webSocketDebuggerUrl':'second'}]
ns['frame_contexts']=lambda *args,**kwargs: [{}]
ns['evaluate_context']=lambda page,*args: fresh if page.url=='first' else None
closed_pages=[]
class CDP:
 def __init__(self,url): self.url=url
 def close(self): closed_pages.append(self.url)
 def command(self,method,*args):
  assert method=='Storage.getCookies', method
  return {'cookies':[{'name':'live'}]}
ns['CDP']=CDP
state=ns['capture_profile_state'](CDP('root'))
assert state=={'cookies':[{'name':'live'}], 'origins':[closed]}
assert closed_pages==['first','second']
`));

test('profile saves use JSON upload then refresh and never live CDP profile commands', () => python(`
calls=[]
state={'cookies':[], 'origins':[]}
ns['capture_profile_state']=lambda cdp: state
ns['browserless_api']=lambda *args: calls.append(args) or {'id':'saved', 'diagnostics':{}}
class CDP:
 def command(self,*args): raise AssertionError('must not mutate browser')
ns['checkpoint_profile'](CDP(),True)
ns['checkpoint_profile'](CDP())
ns['checkpoint_profile'](CDP(),True)
assert [call[0] for call in calls]==['/profile/upload','/profile/refresh']
assert all(call[1:] == ('POST',{'name':'dash-dev-owner','state':state}) for call in calls)
assert ns['BROWSER_STATE']['profileExists'] is True
assert ns['BROWSER_STATE']['savedAt'] > 0
assert 'cookies' not in json.load(open(ns['BROWSER_STATE_PATH']))
`));

test('failed or incomplete capture never replaces a saved profile', () => python(`
calls=[]
ns['BROWSER_STATE']={'profileExists':True,'savedAt':123}
ns['browserless_api']=lambda *args: calls.append(args)
def fail(cdp): raise RuntimeError('read failed')
ns['capture_profile_state']=fail
try: ns['checkpoint_profile'](None,True)
except RuntimeError: pass
else: raise AssertionError('capture failure hidden')
assert calls==[]
assert ns['BROWSER_STATE']['savedAt']==123
`));

test('partial upload is reported and subsequent retries refresh the created profile', () => python(`
calls=[]
ns['capture_profile_state']=lambda cdp: {'cookies':[],'origins':[]}
ns['browserless_api']=lambda *args: calls.append(args) or {'diagnostics':{'truncatedOrigins':1}}
for _ in range(2):
 try: ns['checkpoint_profile'](None,True)
 except RuntimeError as error: assert 'completely' in str(error)
 else: raise AssertionError('partial persistence hidden')
assert [call[0] for call in calls]==['/profile/upload','/profile/refresh']
assert 'savedAt' not in ns['BROWSER_STATE']
`));

test('keyboard sequences emit ordered real key events and reject mixed submissions before dispatch', () => python(`
events=[]
ns['hide_visual_cursor']=lambda cdp: None
class CDP:
 def command(self, method, args): events.append((method,args))
ns['press_key'](CDP(),'slate9A')
assert len(events)==14
assert [args['key'] for _,args in events[::2]]==list('slate9A')
assert all(args['type']=='keyDown' and args['text']==args['key'] for _,args in events[::2])
assert all(args['type']=='keyUp' and 'text' not in args for _,args in events[1::2])
assert events[-2][1]['modifiers']==8
assert events[-4][1]['code']=='Digit9'
for invalid in ('slate\\n','slate Enter','a'*33,'Bogus+V',''):
 events.clear()
 try: ns['press_key'](CDP(),invalid)
 except RuntimeError: pass
 else: raise AssertionError('invalid sequence accepted')
 assert not events
ns['press_key'](CDP(),'Enter')
assert len(events)==2 and events[0][1]['key']=='Enter'
`));

test('new runs create their own tab rather than adopting unclaimed popups',()=>python(`
calls=[]
def request(path,method='GET'):
 calls.append(path)
 if path=='/json/list':return [{'id':'unclaimed-popup','type':'page','webSocketDebuggerUrl':'wss://example','url':'https://shop.example'}]
 return {'id':'new-task-tab','webSocketDebuggerUrl':'wss://example'}
ns['json_request']=request
assert ns['choose_target']('new-run')['id']=='new-task-tab'
assert any(path.startswith('/json/new?') for path in calls)
assert ns['read_target_id'](ns['target_path']('new-run'))=='new-task-tab'
`));

test('Browserless target adapter closes tabs through CDP', () => python(`
class Connection:
 def command(self, method, params):
  assert method == 'Target.closeTarget'
  assert params == {'targetId':'owned-tab'}
  return {'success':True}
ns['BROWSER_CONNECTION']=Connection()
assert ns['json_request']('/json/close/owned-tab')['success']
`));

test('closing the selected tab does not query its disconnected session afterward', () => python(`
class Connection:
 closed=False
 def command(self,*args,**kwargs):
  assert not self.closed
  return {}
 def observations(self):
  assert not self.closed
  return {}
 def close(self):pass
cdp=Connection()
ns['CDP']=lambda endpoint:cdp
ns['browser_diagnostic']=lambda *args:cdp.observations()
def close_tab(*args):
 cdp.closed=True
 return {'tabs':[]}
ns['extended_browser']=close_tab
out=io.StringIO()
with contextlib.redirect_stdout(out):
 ns['execute_request']({'operation':'extended','payload':{'action':'tabs_close','id':'owned'}},{'id':'owned','webSocketDebuggerUrl':'ws://fake'})
assert json.loads(out.getvalue())['ok']
`));

test('observations refresh stale contexts once and reconnect only dropped read transports', () => python(`
class CDP:
 frame_context_cache=['stale']
 reconnects=0
 def reconnect_observation(self): self.reconnects+=1
cdp=CDP()
for message in ['Cannot find context with specified id','The persistent browser connection ended']:
 calls=[]
 def read():
  calls.append(1)
  if len(calls)==1: raise RuntimeError(message)
  assert cdp.frame_context_cache is None
  return 'fresh'
 assert ns['recover_observation'](cdp,read)=='fresh'
 assert len(calls)==2
assert cdp.reconnects==1
calls=[]
def broken():
 calls.append(1)
 raise RuntimeError('Cannot find context with specified id')
try: ns['recover_observation'](cdp,broken)
except RuntimeError: pass
else: raise AssertionError('unbounded recovery')
assert len(calls)==2
calls=[]
def rejected():
 calls.append(1)
 raise RuntimeError('Permission denied')
try: ns['recover_observation'](cdp,rejected)
except RuntimeError: pass
assert len(calls)==1
`));

test('profile diagnostics identify failures without exposing page or provider secrets', () => python(`
ns['DIAGNOSTICS_ENABLED']=True
capture=io.StringIO()
with contextlib.redirect_stdout(capture):
 for message in ['Cannot find context with specified id private-token','profile_non_json_storage secret','Browserless API returned HTTP 413 secret','unknown private-token']:
  ns['profile_failure_diagnostic'](RuntimeError(message))
output=capture.getvalue()
assert 'private-token' not in output and 'secret' not in output
codes=[json.loads(line.removeprefix('DASH_DIAGNOSTIC '))['errorCode'] for line in output.splitlines()]
assert codes==['profile_stale_context','profile_non_json_storage','profile_http_413','profile_capture_failed']
`));

test('profile queue coalesces changes, respects backoff and does not save inline', () => python(`
ns['BROWSER_STATE']={'generation':'test'}
ns['time'].time=lambda: 100
ns['queue_profile_save']()
first=ns['read_profile_json'](ns['profile_file']('pending'))
ns['time'].time=lambda: 101
ns['queue_profile_save']()
second=ns['read_profile_json'](ns['profile_file']('pending'))
assert first['id'] != second['id'] and second['firstRequestedAt']==100
assert ns['profile_save_due'](second,{},101)==103
assert ns['profile_save_due'](second,{'generation':'test','nextAttemptAt':160},101)==160
assert ns['profile_save_due'](second,{'generation':'test','savedRequest':second['id']},101) is None
assert ns['profile_save_due'](second,{'generation':'old','nextAttemptAt':999},101)==103
assert ns['profile_save_due'](dict(second,requestedAt=120),{},120)==110
`));

test('background saves preserve concurrent browser state and retain safe failure counters', () => python(`
state={'generation':'test','ws':'wss://production-sfo.browserless.io/reconnect/test','expiresAt':time.time()+500,'live':{'latest':'viewer'}}
ns['private_json'](ns['BROWSER_STATE_PATH'],state)
class CDP:
 def __init__(self,url): pass
 def close(self): pass
ns['DirectCDP']=CDP
calls=[]
def checkpoint(cdp,force,persist=True):
 assert force and not persist
 calls.append(1)
 ns['BROWSER_STATE']['profileExists']=True
 error=RuntimeError('profile_partial_save secret-token')
 error.profile_diagnostics={'truncatedOrigins':2,'secret':'cookie-value'}
 raise error
ns['checkpoint_profile']=checkpoint
request={'generation':'test','id':'one'}
ns['save_profile_request'](request)
status=ns['read_profile_json'](ns['profile_file']('status'))
assert status['failures']==1 and status['diagnostics']=={'truncatedOrigins':2}
assert 29 < status['nextAttemptAt']-time.time() <= 30
assert 'secret' not in json.dumps(status)
assert json.load(open(ns['BROWSER_STATE_PATH']))==state
ns['save_profile_request'](request)
assert ns['read_profile_json'](ns['profile_file']('status'))['failures']==2
ns['save_profile_request']({'generation':'old','id':'stale'})
assert len(calls)==2
ns['checkpoint_profile']=lambda *args,**kwargs: None
ns['save_profile_request'](dict(request,id='latest'))
status=ns['read_profile_json'](ns['profile_file']('status'))
assert status['savedRequest']=='latest' and status['failures']==0 and 'errorCode' not in status
`));

test('profile capture prioritizes active storage within the 50-origin provider cap', () => python(`
ns['BROWSER_STATE']={'profileExists':True}
old=[{'origin':'https://old'+str(i)+'.example.com','localStorage':{'auth':'fixture'}} for i in range(50)]
ns['browserless_api']=lambda *args: {'origins':old}
ns['json_request']=lambda *args: [{'webSocketDebuggerUrl':'page'}]
ns['frame_contexts']=lambda *args,**kwargs: [{}]
fresh={'origin':'https://current.example.com','localStorage':{'auth':'current'}}
ns['evaluate_context']=lambda *args:fresh
class CDP:
 def __init__(self,url):pass
 def close(self):pass
 def command(self,*args):return {'cookies':[]}
ns['CDP']=CDP
saved=ns['capture_profile_state'](CDP('root'))
assert len(saved['origins'])==50 and saved['origins'][0]==fresh
assert old[0] in saved['origins'] and old[-1] not in saved['origins']
`));

test('worker saves changes queued during capture and stops retrying unchanged partial saves', () => python(`
state={'generation':'test','expiresAt':time.time()+100}
ns['private_json'](root+'/browserless.json',state)
request={'generation':'test','id':'one','requestedAt':0,'firstRequestedAt':0}
ns['private_json'](ns['profile_file']('pending'),request)
calls=[]
def save(request):
 calls.append(request['id'])
 ns['private_json'](ns['profile_file']('status'),{'generation':'test','savedRequest':request['id']})
 if request['id']=='one': ns['private_json'](ns['profile_file']('pending'),dict(request,id='two'))
ns['save_profile_request']=save
ns['serve_profile_worker']()
assert calls==['one','two']
ns['private_json'](ns['profile_file']('status'),{'generation':'test','attemptedRequest':'two','errorCode':'profile_partial_save','failures':1})
ns['serve_profile_worker']()
assert calls==['one','two']
`));

test('explicit browser closure makes one final checkpoint for pending changes', () => python(`
ns['BROWSER_STATE']={'generation':'test'}
ns['private_json'](ns['profile_file']('pending'),{'generation':'test','id':'last'})
calls=[]
ns['checkpoint_profile']=lambda *args:calls.append(1)
ns['flush_profile_before_close']()
assert calls==[1]
assert ns['read_profile_json'](ns['profile_file']('stop'))['generation']=='test'
ns['private_json'](ns['profile_file']('status'),{'generation':'test','savedRequest':'last'})
ns['flush_profile_before_close']()
assert calls==[1]
`));


test('automation restores persistent page focus before input and after takeover', () => python(`
calls=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,params=None,**kwargs): calls.append((method,params)); return {}
 def close(self): pass
ns['CDP']=CDP
ns['queue_profile_save']=lambda: None
ns['BROWSER_STATE']={'live':{'run':{'id':'viewer','control':True,'expiresAt':time.time()+60}}}
with contextlib.redirect_stdout(io.StringIO()):
 ns['execute_request']({'operation':'end_takeover'},{'id':'tab','webSocketDebuggerUrl':'unused'})
assert ('Emulation.setFocusEmulationEnabled',{'enabled':True}) in calls
assert 'run' not in ns['BROWSER_STATE']['live']
calls.clear()
def stop_before_input(*args,**kwargs): raise RuntimeError('preflight reached')
ns['describe']=stop_before_input
try: ns['execute_request']({'operation':'click','payload':{'ref':'e1'}},{'id':'tab','webSocketDebuggerUrl':'unused'})
except Exception: pass
methods=[method for method,params in calls]
assert methods.index('Emulation.setFocusEmulationEnabled') < methods.index('Page.bringToFront')
assert not any(method.startswith('Input.') for method in methods)
`));


test('late child-world acknowledgement cannot become the next command result', () => python(`
cdp=object.__new__(ns['DirectCDP'])
cdp.next_id=1;cdp.page_session='page';cdp.attached_targets={};cdp.events=[]
class Socket:
 def settimeout(self,value):pass
cdp.sock=Socket();sent=[];cdp.send=lambda message:sent.append(message)
def timeout():raise TimeoutError()
cdp.receive=timeout
try:cdp.command('Page.createIsolatedWorld',{'frameId':'child'},timeout=2)
except RuntimeError as error:assert str(error).startswith('CDP command Page.createIsolatedWorld timed out')
else:raise AssertionError('Timeout missing')
replies=iter([{'id':1,'result':{'executionContextId':77}},{'id':2,'result':{'result':{'value':'current'}}}])
cdp.receive=lambda:next(replies)
assert cdp.command('Runtime.evaluate',{'expression':'document.title'})=={'result':{'value':'current'}}
assert [m['id'] for m in sent]==[1,2]
`));

test('isolated world reuse retains fresh reads and expires on document or context lifecycle events', () => python(`
cdp=object.__new__(ns['DirectCDP'])
cdp.next_id=1;cdp.page_session='page';cdp.attached_targets={};cdp.events=[]
class Socket:
 def settimeout(self,value):pass
cdp.sock=Socket();sent=[];cdp.send=lambda message:sent.append(message)
cdp.receive=lambda:{'id':sent[-1]['id'],'result':{'executionContextId':sent[-1]['id']} if sent[-1]['method']=='Page.createIsolatedWorld' else {'result':{'value':len(sent)}}}
params={'frameId':'main','worldName':'snapshot'}
first=cdp.command('Page.createIsolatedWorld',params)
assert cdp.command('Page.createIsolatedWorld',params)==first and len(sent)==1
assert cdp.command('Runtime.evaluate',{'contextId':first['executionContextId'],'expression':'document.title'})['result']['value']==2
assert cdp.command('Runtime.evaluate',{'contextId':first['executionContextId'],'expression':'document.title'})['result']['value']==3
cdp.record_event({'method':'Page.frameNavigated','sessionId':'other','params':{'frame':{'id':'main'}}})
assert cdp.command('Page.createIsolatedWorld',params)==first
for event in [
 {'method':'Runtime.executionContextDestroyed','sessionId':'page','params':{'executionContextId':first['executionContextId']}},
 {'method':'Page.frameNavigated','sessionId':'page','params':{'frame':{'id':'main'}}},
 {'method':'Page.frameDetached','sessionId':'page','params':{'frameId':'main'}},
 {'method':'Runtime.executionContextsCleared','sessionId':'page'},
 {'method':'Target.detachedFromTarget','params':{'sessionId':'page'}},
]:
 before=len(sent);cdp.record_event(event)
 cdp.command('Page.createIsolatedWorld',params)
 assert len(sent)==before+1,event
# A missed lifecycle event cannot keep a known-invalid context cached.
cdp.receive=lambda:{'id':sent[-1]['id'],'error':{'message':'Cannot find context with specified id'}}
try:cdp.command('Runtime.evaluate',{'contextId':99,'expression':'document.title'})
except RuntimeError:pass
else:raise AssertionError('Missing stale-context error')
assert not cdp.isolated_worlds
`));

test('diagnostic timeout cannot discard or use the input transport and is not retried within a request', () => python(`
ns.update(DIAGNOSTICS_ENABLED=True,BROWSER_STATE={})
class Input:
 endpoint='wss://example.invalid/test'
 def observations(self):return {}
 def command(self,*args,**kwargs):raise AssertionError('Diagnostic used input connection')
class Diagnostic:
 def __init__(self,endpoint,channel):assert channel=='diagnostic';self.calls=0
 def command(self,method,params,**kwargs):
  self.calls+=1
  assert method=='Runtime.evaluate' and kwargs['timeout']==1
  raise RuntimeError('CDP command Runtime.evaluate timed out')
ns['PooledCDP']=Diagnostic
cdp=Input()
ns['browser_diagnostic'](cdp,'before_operation')
ns['browser_diagnostic'](cdp,'after_operation')
assert cdp.diagnostic_transport.calls==1 and cdp.diagnostic_unavailable
`));

test('frame liveness follows Runtime events and cannot leak between target sessions', () => python(`
cdp=object.__new__(ns['DirectCDP']);cdp.page_session='page';cdp.events=[];cdp.attached_targets={}
def created(session,context,frame):
 cdp.record_event({'method':'Runtime.executionContextCreated','sessionId':session,'params':{'context':{'id':context,'auxData':{'frameId':frame}}}})
created('page',1,'main');created('page',2,'child');created('other',2,'foreign')
assert cdp.frame_is_live('main') and cdp.frame_is_live('child')
assert not cdp.frame_is_live('foreign')
cdp.record_event({'method':'Runtime.executionContextDestroyed','sessionId':'page','params':{'executionContextId':2}})
assert not cdp.frame_is_live('child') and cdp.frame_is_live('foreign','other')
created('page',3,'child')
cdp.record_event({'method':'Page.frameDetached','sessionId':'page','params':{'frameId':'child'}})
assert not cdp.frame_is_live('child') and cdp.frame_is_live('main')
created('page',4,'child')
cdp.record_event({'method':'Page.frameNavigated','sessionId':'page','params':{'frame':{'id':'child'}}})
assert not cdp.frame_is_live('child')
created('page',5,'child')
cdp.record_event({'method':'Runtime.executionContextsCleared','sessionId':'page'})
assert not cdp.frame_is_live('main') and not cdp.frame_is_live('child')
assert cdp.frame_is_live('foreign','other')
cdp.record_event({'method':'Target.detachedFromTarget','params':{'sessionId':'other'}})
assert not cdp.frame_is_live('foreign','other')
`));

test('bounded CDP read preserves a partial WebSocket acknowledgement across timeout', () => python(`
import struct
cdp=object.__new__(ns['DirectCDP']);cdp.next_id=1;cdp.page_session=None;cdp.attached_targets={};cdp.events=[]
sent=[];cdp.send=lambda message:sent.append(message)
def frame(value):
 body=json.dumps(value).encode();return bytes([0x81,len(body)])+body
first=frame({'id':1,'result':{'executionContextId':7}})
second=frame({'id':2,'result':{'value':'fresh'}})
class Socket:
 def __init__(self):self.data=bytearray(first[:9]);self.paused=True
 def settimeout(self,value):pass
 def recv(self,count):
  if not self.data and self.paused:raise TimeoutError()
  result=bytes(self.data[:count]);del self.data[:count];return result
cdp.sock=Socket()
try:cdp.command('Page.createIsolatedWorld',{'frameId':'child'},timeout=2)
except RuntimeError as error:assert 'timed out' in str(error)
else:raise AssertionError('Timeout expected')
cdp.sock.data.extend(first[9:]+second);cdp.sock.paused=False
assert cdp.command('Runtime.evaluate',{'expression':'document.title'})=={'value':'fresh'}
assert [m['id'] for m in sent]==[1,2]
`));


test('idle CDP reads preserve a slow partial event instead of dropping a healthy connection', () => python(`
cdp=object.__new__(ns['DirectCDP']);cdp.events=[]
body=json.dumps({'method':'Page.loadEventFired','params':{'timestamp':1}}).encode()
frame=bytes([0x81,len(body)])+body
class Socket:
 def __init__(self):self.data=bytearray(frame[:7]);self.timeouts=[]
 def pending(self):return len(self.data)
 def settimeout(self,value):self.timeouts.append(value)
 def recv(self,count):
  if not self.data:raise TimeoutError()
  result=bytes(self.data[:count]);del self.data[:count];return result
cdp.sock=Socket()
assert cdp.poll_idle() is False
assert max(cdp.sock.timeouts)<=.01
assert bytes(cdp.receive_buffer)==frame[:7]
cdp.sock.data.extend(frame[7:])
assert cdp.poll_idle() is True
assert [event['method'] for event in cdp.take_events()]==['Page.loadEventFired']
`));

test('Page and Runtime are enabled once per live session, with option and disable invalidation', () => python(`
cdp=object.__new__(ns['DirectCDP']);cdp.next_id=1;cdp.page_session='main';cdp.attached_targets={}
sent=[];cdp.send=lambda message:sent.append(message)
class Socket:
 def settimeout(self,value):pass
cdp.sock=Socket()
cdp.receive=lambda:{'id':sent[-1]['id'],'result':{}}
for _ in range(3):
 cdp.command('Page.enable');cdp.command('Runtime.enable')
assert len(sent)==2
cdp.command('Page.enable',{'enableFileChooserOpenedEvent':True})
cdp.command('Page.enable',{'enableFileChooserOpenedEvent':True})
assert len(sent)==3
cdp.command('Runtime.enable',session_id='child')
assert len(sent)==4
cdp.command('Runtime.disable');cdp.command('Runtime.enable')
assert len(sent)==6
cdp.command('Runtime.enable',session_id='child')
assert len(sent)==6
def fail():raise TimeoutError()
cdp.receive=fail
try:cdp.command('Runtime.enable',session_id='other')
except RuntimeError:pass
else:raise AssertionError('Timeout missing')
cdp.receive=lambda:{'id':sent[-1]['id'],'result':{}}
cdp.command('Runtime.enable',session_id='other')
assert len(sent)==8, 'Failed enables must not be cached'
for _ in range(3):cdp.command('Target.setDiscoverTargets',{'discover':True})
assert len(sent)==9 and 'sessionId' not in sent[-1]
cdp.command('Target.setDiscoverTargets',{'discover':False})
cdp.command('Target.setDiscoverTargets',{'discover':True})
assert len(sent)==11
cdp.command('Target.setDiscoverTargets',{'discover':True,'filter':[{'type':'page'}]})
assert len(sent)==12

`));

test('late input acknowledgement is drained without replay before a fresh observation', () => python(`
cdp=object.__new__(ns['DirectCDP']);cdp.next_id=1;cdp.page_session='page';cdp.attached_targets={};cdp.events=[]
sent=[];cdp.send=lambda message:sent.append(message)
class Socket:
 def settimeout(self,value):pass
cdp.sock=Socket()
def timeout():raise TimeoutError()
cdp.receive=timeout
try:cdp.command('Input.dispatchMouseEvent',{'type':'mouseReleased'},timeout=.1)
except RuntimeError as error:assert 'timed out' in str(error)
else:raise AssertionError('Input timeout must remain an error')
replies=iter([{'id':1,'result':{}},{'id':2,'result':{'result':{'value':'new page'}}}])
cdp.receive=lambda:next(replies)
assert cdp.command('Runtime.evaluate',{'expression':'document.title'})=={'result':{'value':'new page'}}
assert [m['method'] for m in sent]==['Input.dispatchMouseEvent','Runtime.evaluate']
`));

test('offline Discord reproduction: takeover blocks cookie import; explicit release permits it', () => python(`
import socket
# Fail closed if any code attempts a real connection. No paid browser is created.
def offline(*args, **kwargs): raise AssertionError('Network access forbidden in reproduction')
socket.socket=offline
ns['urllib'].request.urlopen=offline
calls=[]
class CDP:
 def __init__(self,url): pass
 def command(self,method,*args,**kwargs): calls.append(method); return {}
 def close(self): pass
ns.update(CDP=CDP, browser_diagnostic=lambda *args:None, queue_profile_save=lambda:None, profile_save_warning=lambda:None)
ns['BROWSER_STATE']={'live':{'run':{'id':'fixture-stream','control':True,'expiresAt':time.time()+600}}}
target={'id':'fixture-tab','webSocketDebuggerUrl':'offline'}
request={'operation':'import_cookies','payload':{'cookies':[{'name':'session','value':'synthetic-only','domain':'ptb.discord.com','path':'/'}]}}
try: ns['execute_request'](request,target)
except RuntimeError as error:
 assert str(error)=='The user is controlling this browser. Wait until they choose Continue.'
else: raise AssertionError('Expected the production handoff failure')
assert 'Network.setCookies' not in calls, 'Import must have failed before cookies were applied'
with contextlib.redirect_stdout(io.StringIO()) as output:
 ns['execute_request']({'operation':'end_takeover'},target)
 ns['execute_request'](request,target)
results=[json.loads(line) for line in output.getvalue().splitlines()]
assert results[-1]['value']['imported']==1
assert calls.index('Browserless.closeLiveURL') < calls.index('Network.setCookies')
assert 'run' not in ns['BROWSER_STATE']['live']
`));

test('offline Discord reproduction: provider solved flag can coexist with an uncleared challenge', () => python(`
import socket
def offline(*args, **kwargs): raise AssertionError('Network access forbidden in reproduction')
socket.socket=offline
ns['urllib'].request.urlopen=offline
class CDP:
 def __init__(self,url): pass
 def command(self,method,*args,**kwargs):
  return {'captchaFound':False,'solved':True} if method=='Browserless.solveCaptcha' else {}
 def close(self): pass
ns.update(CDP=CDP, browser_diagnostic=lambda *args:None, profile_save_warning=lambda:None,
 snapshot=lambda cdp:{'text':'Wait! Are you human?','url':'https://ptb.discord.com/login'})
ns['BROWSER_STATE']={'live':{}}
with contextlib.redirect_stdout(io.StringIO()) as output:
 ns['execute_request']({'operation':'solve_captcha'},{'id':'fixture-tab','webSocketDebuggerUrl':'offline'})
value=json.loads(output.getvalue())['value']
assert value['found'] is False and value['solved'] is True
assert 'Are you human?' in value['page']['text']
`));

test('cached backend identities require the same frame, document and actual node token', () => python(`
cdp=object.__new__(ns['DirectCDP'])
entry={'sessionId':'child','documents':json.dumps([['frame','document']]),'refs':{'42':'e1'},'tokens':{'e1':['frame','token']}}
cdp.reference_maps([],updates=[entry])
assert cdp.reference_backend('child','frame','document','e1','token')==42
for args in [('other','frame','document','e1','token'),('child','other','document','e1','token'),('child','frame','new-document','e1','token'),('child','frame','document','e1','cloned-node'),('child','frame','document','e2','token')]:
 assert cdp.reference_backend(*args) is None
request={'sessionId':'child','documents':entry['documents'],'refs':['e1'],'tokens':{'e1':['frame','token']}}
assert cdp.reference_maps([request])==[entry['refs']]
request['tokens']['e1']=['frame','new-token']
assert cdp.reference_maps([request])==[None]
entry['refs']['43']='e1'
assert cdp.reference_backend('child','frame','document','e1','token') is None
`));


test('a stale transport retries only the read-only health probe against the same browser',()=>python(`
state={'ws':'wss://production-sfo.browserless.io/reconnect/original','expiresAt':time.time()+1000,'generation':'unchanged','live':{}}
ns['private_json'](ns['BROWSER_STATE_PATH'],state)
calls=[]
class CDP:
 def __init__(self,url):calls.append(('connect',url))
 def command(self,method):
  calls.append(('command',method))
  if len([c for c in calls if c[0]=='command'])==1:raise RuntimeError('[Errno 9] Bad file descriptor')
  return {'targetInfos':[{'targetId':'original-tab'}]}
 def close(self):calls.append(('close',))
ns['CDP']=CDP
ns['browserless_api']=lambda *args: (_ for _ in ()).throw(AssertionError('Created a replacement browser'))
ns['connect_browser']({'operation':'click','payload':{'ref':'e1'}})
assert [c[1] for c in calls if c[0]=='command']==['Target.getTargets','Target.getTargets']
assert len(set(c[1] for c in calls if c[0]=='connect'))==1
assert ns['BROWSER_STATE']==state
assert json.load(open(ns['BROWSER_STATE_PATH']))==state
`));

test('dead transport recovery is bounded and never creates a browser for input',()=>python(`
ns['private_json'](ns['BROWSER_STATE_PATH'],{'ws':'wss://production-sfo.browserless.io/reconnect/dead','expiresAt':time.time()+1000})
calls=[]
class CDP:
 def __init__(self,url):pass
 def command(self,method):calls.append(method);raise RuntimeError('Cloud Chrome closed the DevTools connection')
 def close(self):pass
ns['CDP']=CDP
ns['browserless_api']=lambda *args: (_ for _ in ()).throw(AssertionError('Created a browser for stale input'))
try:ns['connect_browser']({'operation':'secure_type','payload':{'ref':'e1'}})
except RuntimeError as error:assert 'not running' in str(error)
else:raise AssertionError('Dead browser accepted')
assert calls==['Target.getTargets','Target.getTargets']
# A command timeout is not automatically retried, nor is an invalid endpoint.
calls.clear()
def timeout(self,method):calls.append(method);raise RuntimeError('CDP command Target.getTargets timed out')
CDP.command=timeout
try:ns['connect_browser']({'operation':'click'})
except RuntimeError:pass
assert calls==['Target.getTargets']
`));


test('connection probe diagnostics never expose the endpoint or exception text',()=>python(`
ns['private_json'](ns['BROWSER_STATE_PATH'],{'ws':'wss://production-sfo.browserless.io/reconnect/private','expiresAt':time.time()+1000})
ns['DIAGNOSTICS_ENABLED']=True
class CDP:
 def __init__(self,url):pass
 def command(self,method):raise RuntimeError('Cloud Chrome closed: credential-and-private-url')
 def close(self):pass
ns['CDP']=CDP
output=io.StringIO()
with contextlib.redirect_stdout(output):
 try:ns['connect_browser']({'operation':'snapshot'})
 except RuntimeError:pass
text=output.getvalue()
assert 'credential-and-private-url' not in text and 'test-token' not in text
rows=[json.loads(line.removeprefix('DASH_DIAGNOSTIC ')) for line in text.splitlines()]
assert [r['attempt'] for r in rows]==[1,2]
assert all(r['errorCode']=='transport_closed' for r in rows)
`));

test('input reconnects never close a healthy independent viewer', () => python(`
calls=[]
class Input:
 endpoint='wss://production-sfo.browserless.io/reconnect/session#tab'
 def __init__(self,url): pass
 def command(self,method,params=None,**kwargs):calls.append(('input',method));return {}
 def close(self):pass
class Viewer:
 def __init__(self,endpoint,channel=None):assert channel=='viewer';assert endpoint==Input.endpoint
 def transport_identity(self):return {'key':'viewer','token':'stable'}
 def command(self,method,params=None,**kwargs):
  calls.append(('viewer',method))
  if method=='Browserless.liveURL':return {'liveURLId':'view','liveURL':'https://production-sfo.browserless.io/live/view','timeout':50000}
  return {}
ns['CDP']=Input;ns['PooledCDP']=Viewer;ns['session_remaining_ms']=lambda:900000
ns['BROWSER_STATE']={}
for _ in range(3):
 with contextlib.redirect_stdout(io.StringIO()):ns['execute_request']({'operation':'live_url','payload':{'control':False}},{'id':'tab','webSocketDebuggerUrl':Input.endpoint})
assert calls.count(('viewer','Browserless.liveURL'))==1,calls
assert not any(method=='Browserless.closeLiveURL' for _,method in calls),calls
assert 48000<ns['BROWSER_STATE']['live']['run']['expiresAt']*1000-time.time()*1000<=50000
assert ns['BROWSER_STATE']['live']['run']['transport']=={'key':'viewer','token':'stable'}
`));

test('provider live completion invalidates viewer health without closing the browser', () => python(`
cdp=object.__new__(ns['DirectCDP']);cdp.events=[];cdp.page_session='page';cdp.attached_targets={}
cdp.record_event({'method':'Browserless.liveComplete','params':{},'sessionId':'page'})
assert cdp.live_url_epoch==1
cdp.record_event({'method':'Runtime.consoleAPICalled','params':{},'sessionId':'page'})
assert cdp.live_url_epoch==1
`));

test('connection failures retain only numeric protocol status for diagnosis',()=>python(`
ns['private_json'](ns['BROWSER_STATE_PATH'],{'ws':'wss://production-sfo.browserless.io/reconnect/private','expiresAt':time.time()+1000})
ns['DIAGNOSTICS_ENABLED']=True
class CDP:
 def __init__(self,url):pass
 def command(self,method):raise RuntimeError('DevTools WebSocket handshake failed (HTTP 404) private-token')
 def close(self):pass
ns['CDP']=CDP
output=io.StringIO()
with contextlib.redirect_stdout(output):
 try:ns['connect_browser']({'operation':'snapshot'})
 except RuntimeError:pass
assert 'private-token' not in output.getvalue()
rows=[json.loads(line.removeprefix('DASH_DIAGNOSTIC ')) for line in output.getvalue().splitlines()]
assert rows and all(r['httpStatus']==404 for r in rows)
`));

test('reconnect rejection is recorded without silently marking a successful lease',()=>python(`
class CDP:
 def command(self,method,args=None):return {'error':'private-provider-message'}
 def close(self):pass
ns['CDP']=lambda url:CDP();ns['BROWSER_CONNECTION']=CDP();ns['DIAGNOSTICS_ENABLED']=True
ns['browser_diagnostic']=lambda *a:None;ns['json_request']=lambda path:[{'id':'tab','webSocketDebuggerUrl':'unused'}]
ns['BROWSER_STATE']={'expiresAt':time.time()+900}
output=io.StringIO()
with contextlib.redirect_stdout(output):ns['finish_browser']()
assert 'private-provider-message' not in output.getvalue()
row=json.loads(output.getvalue().split('DASH_DIAGNOSTIC ')[1])
assert row['accepted']==False and row['errorCode']=='provider_rejected'
assert 'reconnectLease' not in ns['BROWSER_STATE']
`));

test('closed passive stream refresh remints only the viewer and never overrides takeover',()=>python(`
calls=[]
class CDP:
 def __init__(self,url):pass
 def command(self,method,params=None,**kwargs):
  calls.append(method)
  if method=='Browserless.liveURL':return {'liveURLId':'new','liveURL':'https://production-sfo.browserless.io/live/new'}
  return {}
 def close(self):pass
ns['CDP']=CDP;ns['session_remaining_ms']=lambda:900000
ns['BROWSER_STATE']={'generation':'same-browser','live':{'run':{'id':'old','url':'old','control':False,'expiresAt':time.time()+900}}}
with contextlib.redirect_stdout(io.StringIO()):ns['execute_request']({'operation':'live_url','payload':{'control':False,'refresh':True}},{'id':'tab','webSocketDebuggerUrl':'unused'})
assert calls.count('Browserless.liveURL')==1 and 'Browserless.closeLiveURL' in calls
assert not any(m in ('Page.navigate','Browser.close','Target.createTarget') for m in calls)
assert ns['BROWSER_STATE']['generation']=='same-browser'
ns['BROWSER_STATE']['live']['run']['control']=True
calls.clear()
try:ns['execute_request']({'operation':'live_url','payload':{'control':False,'refresh':True}},{'id':'tab','webSocketDebuggerUrl':'unused'})
except ns['PreDispatchError']:pass
else:raise AssertionError('Passive recovery overrode takeover')
assert 'Browserless.liveURL' not in calls and 'Browserless.closeLiveURL' not in calls
`));

test('proxy CONNECT failures retry navigation once, without replaying input or unrelated errors',()=>python(`
class Fake:
 def __init__(self, errors): self.errors=iter(errors); self.calls=[]
 def command(self,method,args):
  self.calls.append((method,args))
  error=next(self.errors)
  return {'errorText':error} if error else {'frameId':'page'}
first=Fake(['net::ERR_TUNNEL_CONNECTION_FAILED',None])
assert ns['navigate_with_tunnel_retry'](first,'https://example.com/form')=={'frameId':'page'}
assert len(first.calls)==2 and all(c[0]=='Page.navigate' for c in first.calls)
failed=Fake(['net::ERR_TUNNEL_CONNECTION_FAILED','net::ERR_TUNNEL_CONNECTION_FAILED'])
try: ns['navigate_with_tunnel_retry'](failed,'https://example.com/form')
except RuntimeError as e: assert 'retry also failed' in str(e)
else: raise AssertionError('Persistent proxy failure hidden')
assert len(failed.calls)==2
other=Fake(['net::ERR_CONNECTION_RESET'])
try: ns['navigate_with_tunnel_retry'](other,'https://example.com/form')
except RuntimeError: pass
else: raise AssertionError('Other error hidden')
assert len(other.calls)==1
`));

test('cursor renders main-frame controls resolved through fast ref routing with an empty frame cache',()=>python(`
calls=[]
class CursorCDP:
 endpoint="test-tab"
 frame_context_cache=None
 def command(self,method,params=None,**kwargs):
  calls.append((method,params))
  if method=='Page.createIsolatedWorld':return {'executionContextId':19}
  if method=='Page.addScriptToEvaluateOnNewDocument':return {'identifier':'script'}
  return {}
ns['cursor_transport']=lambda cdp: cdp
ns['private_json']=lambda *args: None
ns['visual_cursor'](CursorCDP(),{'mainFrame':True,'frameId':'main','x':120,'y':80})
assert any(method=='Runtime.evaluate' and params.get('contextId')==19 for method,params in calls)
assert not any(method=='Page.getFrameTree' for method,params in calls)
`));
