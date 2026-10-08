/** Isolated DemoQA reproduction using the production pooled controller lifecycle. */
import { spawn } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const program=`controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\n`+String.raw`
import tempfile,os,time,json,io,contextlib
with tempfile.TemporaryDirectory(prefix='dash-dropdown-') as root:
 source=controller.replace('ROOT = "/home/user/.decision-feed"','ROOT = '+repr(root))
 path=root+'/controller.py';open(path,'w').write(source)
 ns={'__name__':'dropdown_repro','__file__':path};exec(source,ns)
 os.makedirs(root+'/targets');ns['CURRENT_TARGET_KEY']='form'
 os.environ['BROWSERLESS_PROFILE']='dash-dropdown-'+str(int(time.time()))
 os.environ['BROWSERLESS_SESSION_TIMEOUT_MS']='600000'
 def connect():
  ns['connect_browser']({'operation':'snapshot'})
  t=ns['choose_target']('form');return t,ns['CDP'](t['webSocketDebuggerUrl'])
 def read(label):
  t,c=connect()
  value=ns['evaluate'](c,"({focus:document.hasFocus(),active:document.activeElement?.id,state:document.querySelector('#state')?.innerText,city:document.querySelector('#city')?.innerText,expanded:[...document.querySelectorAll('[aria-expanded]')].map(e=>({id:e.id,expanded:e.getAttribute('aria-expanded')})),options:[...document.querySelectorAll('[role=option]')].map(e=>e.textContent)})")
  c.close();print(json.dumps({'stage':label,'state':value}),flush=True)
  return value
 def rpc(operation,payload):
  ns['connect_browser']({'operation':operation});t=ns['choose_target']('form',operation=='navigate')
  out=io.StringIO();started=time.time()
  try:
   with contextlib.redirect_stdout(out):ns['execute_request']({'operation':operation,'payload':payload},t)
   result=json.loads(out.getvalue().splitlines()[-1])['value']
  finally:
   ns['finish_browser']()
   print(json.dumps({'operation':operation,'action':payload.get('action'),'started':int(started*1000),'ended':int(time.time()*1000)}),flush=True)
  return result
 def query(q):return rpc('extended',{'action':'query','locator':q})['matches']
 def click(q):
  rows=query(q)
  print(json.dumps({'query':q,'matches':[{k:r.get(k) for k in ('ref','name','visible','rect')} for r in rows]}),flush=True)
  if len(rows)!=1:raise RuntimeError('Expected one match')
  rpc('click',{'ref':rows[0]['ref']})
 try:
  print('Opening isolated DemoQA page with production controller',flush=True)
  rpc('navigate',{'url':'https://demoqa.com/automation-practice-form'})
  t,c=connect()
  for _ in range(30):
   if ns['evaluate'](c,"Boolean(document.querySelector('#state input'))"):break
   time.sleep(1)
  c.close();read('ready')
  for attempt in range(2):
   print('ATTEMPT '+str(attempt+1),flush=True)
   click({'css':'#state input'})
   opened=read('state-open')
   options=query({'role':'option','name':'NCR'})
   read('after-option-query')
   assert len(options)==1, 'State option disappeared before selection'
   rpc('click',{'ref':options[0]['ref']});read('state-selected')
   click({'css':'#city input'});read('city-open')
   options=query({'role':'option','name':'Delhi'});read('after-city-query')
   assert len(options)==1, 'City option disappeared before selection'
   rpc('click',{'ref':options[0]['ref']});state=read('city-selected')
   assert state.get('state','').split('\n')[-1]=='NCR' and state.get('city','').split('\n')[-1]=='Delhi', 'Selection not retained'
   print('PASS NCR Delhi',flush=True)
  subject=query({'css':'#subjectsInput'})
  assert len(subject)==1
  rpc('type',{'ref':subject[0]['ref'],'text':'Maths'})
  options=query({'role':'option','name':'Maths'})
  assert len(options)==1, 'Key-driven subject autocomplete did not appear'
  rpc('click',{'ref':options[0]['ref']})
  t,c=connect()
  assert 'Maths' in ns['evaluate'](c,"document.querySelector('#subjectsContainer').innerText")
  c.close()
  print('PASS pipelined keyboard events trigger React autocomplete',flush=True)
 except Exception as e:
  import traceback
  traceback.print_exc()
  raise
 finally:
  try:
   ns['connect_browser']({'operation':'snapshot'});ns['BROWSER_CONNECTION'].command('Browser.close')
  except:pass
  try:ns['browserless_api']('/profile/'+os.environ['BROWSERLESS_PROFILE'],'DELETE')
  except:pass
`;
const child=spawn('python3',['-u','-c',program],{env:process.env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1});
