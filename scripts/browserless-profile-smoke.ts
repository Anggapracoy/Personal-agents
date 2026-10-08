// Paid isolated Browserless smoke. Uses only synthetic storage; deletes its own profile.
// node --env-file=.env.local --conditions=react-server --import tsx scripts/browserless-profile-smoke.ts
import {spawn} from 'node:child_process';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
const program=`controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\n`+String.raw`
import tempfile,io,contextlib
with tempfile.TemporaryDirectory() as directory:
 path=directory+'/controller.py'
 open(path,'w').write(controller)
 ns={'__name__':'diagnostic','__file__':path}
 exec(controller,ns)
 ns.update(ROOT=directory,TARGET_DIR=directory,BROWSER_STATE_PATH=directory+'/state.json',SECRET_KEY_DIR=directory+'/keys',CURRENT_TARGET_KEY='diagnostic')
 os=ns['os'];json=ns['json'];time=ns['time']
 os.environ['BROWSERLESS_PROFILE']='dash-viewport-diagnostic-'+str(int(time.time()))
 os.environ['BROWSERLESS_SESSION_TIMEOUT_MS']='180000'
 ns['connect_browser']({'operation':'navigate'})
 target=ns['choose_target']('diagnostic')
 metrics='({w:innerWidth,h:innerHeight,scale:visualViewport.scale,dpr:devicePixelRatio,outer:[outerWidth,outerHeight]})'
 def measure(cdp,stage,*args):
  try: print(json.dumps({'stage':stage,'size':ns['evaluate'](cdp,metrics)}),flush=True,file=__import__('sys').stderr)
  except Exception as e: print('measure failed '+str(e),file=__import__('sys').stderr)
 ns['browser_diagnostic']=measure
 def op(name,payload={}):
  print('OP '+name,flush=True,file=__import__('sys').stderr)
  capture=io.StringIO()
  with contextlib.redirect_stdout(capture):ns['execute_request']({'operation':name,'payload':payload},target)
  ns['finish_browser']()
  ns['BROWSER_CONNECTION']=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws']))
  return json.loads(capture.getvalue())['value']
 try:
  op('navigate',{'url':'https://example.com'})
  cdp=ns['CDP'](target['webSocketDebuggerUrl'])
  ns['evaluate'](cdp, """(async () => {
   localStorage.setItem('dash-profile-test','local-ok');
   const db = await new Promise((resolve,reject) => {
    const r = indexedDB.open('dash-profile-test',1);
    r.onupgradeneeded = () => { const s=r.result.createObjectStore('auth',{keyPath:'id'});s.createIndex('byEmail','email',{unique:true}); };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
   });
   await new Promise((resolve,reject)=>{const t=db.transaction('auth','readwrite');t.objectStore('auth').put({id:'test',email:'fixture@example.com',token:'idb-ok'});t.oncomplete=resolve;t.onerror=reject;});db.close();
   window.profileResizes=[];
   addEventListener('resize',()=>profileResizes.push([innerWidth,innerHeight]));
   visualViewport.addEventListener('resize',()=>profileResizes.push([visualViewport.width,visualViewport.height]));
   return true;
  })()""")
  cdp.command('Network.setCookie',{'name':'dash_profile_test','value':'cookie-ok','url':'https://example.com','secure':True,'httpOnly':True,'expires':time.time()+3600})
  baseline=ns['evaluate'](cdp,metrics)
  for i in range(5):
   ns['checkpoint_profile'](cdp,True)
   assert ns['evaluate'](cdp,metrics)==baseline,'Viewport changed'
   assert ns['evaluate'](cdp,'window.profileResizes')==[],'Transient resize event'
  print('PASS five checkpoints: zero resize events, stable dimensions and pixel density',flush=True)
  # An uncertain input response must never be replayed by read recovery.
  try:
   cdp.command('Runtime.evaluate',{'expression':'globalThis.recoveryMutationCount=(globalThis.recoveryMutationCount||0)+1;const until=Date.now()+400;while(Date.now()<until){}'},timeout=.05)
  except RuntimeError as error: assert 'timed out' in str(error)
  else: raise AssertionError('Expected dropped transport')
  time.sleep(.5)
  assert ns['snapshot'](cdp)['title']=='Example Domain'
  assert ns['evaluate'](cdp,'globalThis.recoveryMutationCount')==1
  print('PASS dropped transport recovered by observation without replaying uncertain mutation',flush=True)

  cdp.close()
  ns['BROWSER_CONNECTION'].command('Browser.close');ns['BROWSER_CONNECTION'].close()
  os.remove(ns['BROWSER_STATE_PATH']);ns['BROWSER_STATE']={};ns['BROWSER_CONNECTION']=None
  ns['connect_browser']({'operation':'navigate'})
  target=ns['choose_target']('restored')
  op('navigate',{'url':'https://example.com'})
  cdp=ns['CDP'](target['webSocketDebuggerUrl'])
  assert ns['evaluate'](cdp,"localStorage.getItem('dash-profile-test')")=='local-ok'
  cookies=cdp.command('Storage.getCookies')['cookies']
  assert any(c['name']=='dash_profile_test' and c['value']=='cookie-ok' and c['httpOnly'] for c in cookies)
  restored=ns['evaluate'](cdp,"""(async()=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dash-profile-test');r.onsuccess=()=>resolve(r.result);r.onerror=reject});
   try {return await new Promise((resolve,reject)=>{const r=db.transaction('auth').objectStore('auth').index('byEmail').get('fixture@example.com');r.onsuccess=()=>resolve(r.result);r.onerror=reject});}
   finally {db.close();}
  })()""")
  assert restored['token']=='idb-ok'
  cdp.close()
  print('PASS fresh session restored HttpOnly cookie, localStorage, IndexedDB value and index',flush=True)
 finally:
  try:ns['browserless_api']('/profile/'+os.environ['BROWSERLESS_PROFILE'],'DELETE')
  except Exception:pass
  ns['BROWSER_CONNECTION'].command('Browser.close');ns['BROWSER_CONNECTION'].close()
`;
const child=spawn('python3',['-c',program],{env:process.env});
for(const stream of [child.stdout,child.stderr]) stream.on('data',d=>process.stdout.write(String(d).replaceAll(process.env.BROWSERLESS_API_TOKEN??'NO_TOKEN','[redacted]')));
child.on('exit',code=>{process.exitCode=code??1});
