/** Isolated Browserless regression/measurement: no user pages or credentials. */
import { spawn } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const program = `controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\n` + String.raw`
import tempfile,os,time,json,statistics,io,contextlib
with tempfile.TemporaryDirectory() as root:
 ns={'__name__':'targeted_read_smoke'};exec(controller,ns)
 ns.update(ROOT=root,TARGET_DIR=root+'/targets',BROWSER_STATE_PATH=root+'/browserless.json',SECRET_KEY_DIR=root+'/keys',CURRENT_TARGET_KEY='test')
 os.makedirs(root+'/targets')
 os.environ['BROWSERLESS_PROFILE']='dash-targeted-read-'+str(int(time.time()))
 os.environ['BROWSERLESS_SESSION_TIMEOUT_MS']='180000'
 ns['connect_browser']({'operation':'navigate'})
 target=ns['choose_target']('test');cdp=ns['CDP'](target['webSocketDebuggerUrl'])
 calls=[];command=cdp.command
 def measured(method,*a,**kw):
  calls.append(method);return command(method,*a,**kw)
 cdp.command=measured
 try:
  cdp.command('Page.navigate',{'url':'https://example.com'});ns['ready'](cdp)
  ns['evaluate'](cdp,'''(() => {document.body.innerHTML='<form aria-label="Booking"><label>Name<input id="name"></label><button type="button" onclick="window.clicked=(window.clicked||0)+1">Save</button><input type="password" value="PRIVATE_VALUE"></form><div id="outside">Outside text</div><div id="host"></div><iframe srcdoc="<button>Frame button</button>"></iframe>';const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<button>Shadow button</button>';return true;})()''')
  time.sleep(.5)
  full=ns['snapshot'](cdp)
  before=[];after=[]
  for _ in range(3):
   t=time.monotonic();ns['snapshot'](cdp);ns['extended_query'](cdp,{'role':'button','name':'Save'});before.append((time.monotonic()-t)*1000)
   calls.clear();t=time.monotonic();rows=ns['extended_query'](cdp,{'role':'button','name':'Save'});after.append((time.monotonic()-t)*1000)
   assert len(rows)==1
   assert 'Accessibility.getFullAXTree' not in calls and 'DOMSnapshot.captureSnapshot' not in calls,calls
  ref=rows[0]['ref']
  assert rows[0]['rect']['width']>0 and rows[0]['rect']['height']>0,rows[0]
  # Geometry works even on a secure page without allowing arbitrary evaluation.
  try:ns['extended_browser'](cdp,target,{'action':'evaluate','expression':'document.title'});raise AssertionError('secure-page evaluation was allowed')
  except RuntimeError as error:assert 'secure fields' in str(error)
  assert ns['extended_query'](cdp,{'role':'button','name':'Shadow button'})
  frame_button=ns['extended_query'](cdp,{'role':'button','name':'Frame button'})[0]
  frame_scope=ns['inspect_ref'](cdp,frame_button['ref'])
  assert frame_scope['url'].startswith('https://example.com') and 'Frame button' in frame_scope['text'],frame_scope
  assert ns['extended_query'](cdp,{'ref':ref})[0]['ref']==ref
  full=ns['snapshot'](cdp);assert any(e['ref']==ref and e['name']=='Save' for e in full['elements'])
  form=ns['extended_query'](cdp,{'role':'form','name':'Booking'})[0]['ref']
  calls.clear();scope=ns['inspect_ref'](cdp,form)
  assert scope['scopeRef']==form and any(e['name']=='Save' for e in scope['elements']),scope
  assert 'Outside text' not in scope['text'] and 'PRIVATE_VALUE' not in json.dumps(scope),scope
  assert 'Save' in scope['text'],scope
  assert 'Accessibility.getFullAXTree' not in calls and 'DOMSnapshot.captureSnapshot' not in calls,calls
  # Fresh actions retain the complete preflight contract.
  assert ns['preflight_ref'](cdp,ref)['element']['name']=='Save'
  with contextlib.redirect_stdout(io.StringIO()):
   ns['execute_request']({'operation':'click','payload':{'ref':ref}},target)
  assert ns['evaluate'](cdp,'window.clicked')==1
  # Cloning an attributed node must never inherit its previous identity.
  ns['evaluate'](cdp,"(() => {const b=document.querySelector('button');b.replaceWith(b.cloneNode(true));return true;})()")
  assert ns['extended_query'](cdp,{'ref':ref})==[]
  fresh=ns['extended_query'](cdp,{'role':'button','name':'Save'})[0]['ref'];assert fresh!=ref
  try:ns['describe'](cdp,ref);raise AssertionError('old reference survived replacement')
  except RuntimeError:pass
  cdp.command('Page.navigate',{'url':'https://example.com/?fresh=1'});ns['ready'](cdp)
  assert ns['extended_query'](cdp,{'role':'link','name':'Learn more'})
  original=ns['evaluate'](cdp,'document.title')
  try:ns['extended_browser'](cdp,target,{'action':'evaluate','expression':"document.title='MUTATED'"});raise AssertionError('mutation was allowed')
  except RuntimeError as error:assert 'side-effect-free' in str(error)
  assert ns['evaluate'](cdp,'document.title')==original
  print(json.dumps({'previousQueryMedianMs':round(statistics.median(before)),'targetedQueryMedianMs':round(statistics.median(after)),'fullPageReadsPerTargetedQuery':0}),flush=True)
  print('PASS scoped inspection, redaction, shadow DOM, iframe, stable refs, cloned-node rejection, navigation and action preflight',flush=True)
 finally:
  try:ns['BROWSER_CONNECTION'].command('Browser.close')
  except:pass
  try:ns['browserless_api']('/profile/'+os.environ['BROWSERLESS_PROFILE'],'DELETE')
  except RuntimeError as error:
   if 'HTTP 404' not in str(error):raise
`;
const child = spawn('python3', ['-u', '-c', program], { env: process.env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
