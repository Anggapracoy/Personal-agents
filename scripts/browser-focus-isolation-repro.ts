/** Controlled A/B: focus loss closes DemoQA menus unless automation focus is maintained. */
import { spawn } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const program=`controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\n`+String.raw`
import tempfile,os,time,json,io,contextlib
sessions=[]
def session(label,url):
 root=tempfile.TemporaryDirectory(prefix='dash-focus-');path=root.name+'/controller.py'
 source=controller.replace('ROOT = "/home/user/.decision-feed"','ROOT = '+repr(root.name));open(path,'w').write(source)
 ns={'__name__':'focus_repro','__file__':path};exec(source,ns)
 profile='dash-focus-'+label+'-'+str(time.time_ns())
 os.environ['BROWSERLESS_PROFILE']=profile;os.environ['BROWSERLESS_SESSION_TIMEOUT_MS']='600000'
 ns['browserless_profile']=lambda:profile
 ns['queue_profile_save']=lambda:None
 ns['visual_cursor']=lambda *a,**kw:None
 ns['CURRENT_TARGET_KEY']=label;os.makedirs(root.name+'/targets')
 ns['connect_browser']({'operation':'navigate'});target=ns['choose_target'](label)
 c=ns['CDP'](target['webSocketDebuggerUrl']);c.command('Page.enable');c.command('Runtime.enable')
 c.command('Page.navigate',{'url':url});ns['ready'](c)
 sessions.append((root,ns,target,c,profile));return ns,target,c

def state(ns,c,label):
 value=ns['evaluate'](c,"({focus:document.hasFocus(),expanded:document.querySelector('#state input')?.getAttribute('aria-expanded'),options:[...document.querySelectorAll('[role=option]')].map(e=>e.textContent)})")
 print(json.dumps({'label':label,'at':time.time(),'state':value}),flush=True);return value

def open_menu(ns,target,c):
 if ns['evaluate'](c,"document.querySelector('#state input')?.getAttribute('aria-expanded')")=='true':return
 rows=ns['extended_query'](c,{'css':'#state input'});assert len(rows)==1
 with contextlib.redirect_stdout(io.StringIO()):ns['execute_request']({'operation':'click','payload':{'ref':rows[0]['ref']}},target)
 assert state(ns,c,'menu-open')['expanded']=='true'
try:
 a,ta,ca=session('a','https://demoqa.com/automation-practice-form')
 for _ in range(30):
  if a['evaluate'](ca,"Boolean(document.querySelector('#state input'))"):break
  time.sleep(1)
 open_menu(a,ta,ca)
 # Compare the same open dropdown under a controlled tab focus loss.
 tb=a['json_request']('/json/new?https%3A%2F%2Fexample.com','PUT')
 cb=a['CDP'](tb['webSocketDebuggerUrl'])
 for enabled in [False,True]:
  ca.command('Emulation.setFocusEmulationEnabled',{'enabled':True})
  ca.command('Page.bringToFront');open_menu(a,ta,ca)
  ca.command('Emulation.setFocusEmulationEnabled',{'enabled':enabled})
  print('ACTIVATING another tab; focus emulation='+str(enabled),flush=True)
  cb.command('Page.bringToFront');time.sleep(.3)
  value=state(a,ca,'after-tab-switch-emulation-'+str(enabled))
  assert (value['expanded']=='true')==enabled,value
 print('PASS controlled focus-loss A/B: disabled closes menu, enabled preserves it',flush=True)

finally:
 for root,ns,t,c,profile in sessions:
  try:c.command('Browser.close')
  except:pass
  try:ns['browserless_api']('/profile/'+profile,'DELETE')
  except:pass
  root.cleanup()
`;
const child=spawn('python3',['-u','-c',program],{env:process.env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1});
