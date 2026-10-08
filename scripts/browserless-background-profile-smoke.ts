// Isolated paid smoke: hold a profile save open while a foreground read runs,
// then verify a fresh browser restores the saved synthetic login state.
import { spawn } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const program = `controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\n` + String.raw`
import tempfile,os,time,json,io,contextlib,subprocess
with tempfile.TemporaryDirectory() as root:
 path=root+'/controller.py'
 gated=controller.replace('    state = capture_profile_state(cdp)', '''    if not persist:
        open(os.path.join(ROOT,'save-started'),'w').close()
        deadline=time.time()+30
        while not os.path.exists(os.path.join(ROOT,'release-save')):
            if time.time()>deadline: raise RuntimeError('test save gate timed out')
            time.sleep(.05)
    state = capture_profile_state(cdp)''')
 open(path,'w').write(gated)
 ns={'__name__':'profile_smoke','__file__':path};exec(controller,ns)
 ns.update(ROOT=root,TARGET_DIR=root+'/targets',BROWSER_STATE_PATH=root+'/browserless.json',SECRET_KEY_DIR=root+'/keys',CURRENT_TARGET_KEY='test')
 os.makedirs(root+'/targets')
 os.environ['BROWSERLESS_PROFILE']='dash-background-smoke-'+str(int(time.time()))
 os.environ['BROWSERLESS_SESSION_TIMEOUT_MS']='180000'
 ns['connect_browser']({'operation':'navigate'})
 target=ns['choose_target']('test');cdp=ns['CDP'](target['webSocketDebuggerUrl'])
 try:
  cdp.command('Page.navigate',{'url':'https://example.com'})
  ns['ready'](cdp)
  ns['evaluate'](cdp,"(() => {localStorage.setItem('background-auth','fixture');return true;})()")
  cdp.command('Network.setCookie',{'name':'background_auth','value':'fixture','url':'https://example.com','secure':True,'httpOnly':True,'expires':time.time()+3600})
  old=[{'origin':'https://old'+str(i)+'.example.com','localStorage':{'auth':'old-fixture'}} for i in range(50)]
  ns['browserless_api']('/profile/upload','POST',{'name':ns['browserless_profile'](),'state':{'cookies':[],'origins':old}})
  ns['BROWSER_STATE']['profileExists']=True;ns['private_json'](ns['BROWSER_STATE_PATH'],ns['BROWSER_STATE'])
  started=time.monotonic();ns['queue_profile_save']();queue_ms=(time.monotonic()-started)*1000
  assert queue_ms<500,queue_ms
  deadline=time.time()+15
  while not os.path.exists(root+'/save-started'):
   assert time.time()<deadline,'Worker did not start';time.sleep(.1)
  # Also hold the foreground account lock: saving must not need it.
  import fcntl
  with open(root+'/controller.lock','a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   capture=io.StringIO();started=time.monotonic()
   with contextlib.redirect_stdout(capture):ns['execute_request']({'operation':'snapshot'},target)
   read_ms=(time.monotonic()-started)*1000
   assert json.loads(capture.getvalue())['value']['title']=='Example Domain'
   assert not os.path.exists(root+'/release-save')
   open(root+'/release-save','w').close()
   deadline=time.time()+30
   request=ns['read_profile_json'](ns['profile_file']('pending'))
   while True:
    status=ns['read_profile_json'](ns['profile_file']('status'))
    if status.get('savedRequest')==request['id']:break
    assert time.time()<deadline, status;time.sleep(.1)
  state=ns['browserless_api']('/profile/'+ns['browserless_profile']()+'/download')
  assert len(state['origins'])==50
  assert any(o['origin']=='https://example.com' and o['localStorage'].get('background-auth')=='fixture' for o in state['origins'])
  print(json.dumps({'queueMs':round(queue_ms),'foregroundReadMs':round(read_ms),'foregroundCompletedDuringBlockedSave':True,'savedOriginCount':len(state['origins'])}),flush=True)
  ns['flush_profile_before_close']()
  ns['BROWSER_CONNECTION'].command('Browser.close')
  os.remove(ns['BROWSER_STATE_PATH']);ns['BROWSER_STATE']={};ns['BROWSER_CONNECTION']=None
  ns['connect_browser']({'operation':'navigate'})
  target=ns['choose_target']('restored');cdp=ns['CDP'](target['webSocketDebuggerUrl'])
  cdp.command('Page.navigate',{'url':'https://example.com'});ns['ready'](cdp)
  assert ns['evaluate'](cdp,"localStorage.getItem('background-auth')")=='fixture'
  assert any(c['name']=='background_auth' and c['value']=='fixture' for c in cdp.command('Storage.getCookies')['cookies'])
  print('PASS background checkpoint, cap recovery, foreground nonblocking read, and fresh-session login restoration',flush=True)
 finally:
  try:ns['flush_profile_before_close']()
  except:pass
  try:ns['BROWSER_CONNECTION'].command('Browser.close')
  except:pass
  try:ns['browserless_api']('/profile/'+os.environ['BROWSERLESS_PROFILE'],'DELETE')
  except RuntimeError as error:
   if 'HTTP 404' not in str(error):raise
`;
const child=spawn('python3',['-u','-c',program],{env:process.env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
