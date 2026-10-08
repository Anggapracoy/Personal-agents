/**
 * Local Chrome form benchmark; no Browserless, model calls, or external sites.
 * Run: node --conditions=react-server --import tsx scripts/browser-form-local-benchmark.ts
 * Set BROWSER_CONTROLLER_SOURCE to a Python controller file to measure a baseline.
 * Measures controller actions only, excluding browser startup and profile uploads.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const server=createServer((_req,res)=>{
 res.setHeader('Content-Type','text/html');
 res.end(`<title>Simple form benchmark</title><form onsubmit="event.preventDefault();window.submissions++"><label>Text input<input></label><label>Textarea<textarea></textarea></label><label>Dropdown<select><option value="1">One</option><option value="2">Two</option></select></label><label>Default checkbox<input type="checkbox"></label><button>Submit</button></form><script>window.submissions=0</script>`);
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as {port:number}).port;
const reserve=createServer();await new Promise<void>(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const cdpPort=(reserve.address() as {port:number}).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));
const browser=await chromium.launch({headless:true,args:[`--remote-debugging-port=${cdpPort}`,'--site-per-process']});
try {
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${port}/`);
 const targets=await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json() as Array<{type:string;id:string}>;
 const target=targets.find(t=>t.type==='page')!;
 const version=await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json() as {webSocketDebuggerUrl:string};
 const endpoint=version.webSocketDebuggerUrl.replace('ws:','wss:')+'#'+target.id;
 const code=String.raw`
import json,ssl,socket,time,tempfile,contextlib,io,statistics
ns={'__name__':'local_test'}
exec(CONTROLLER,ns)
ns['browserless_url']=lambda endpoint:endpoint
connect=socket.create_connection
socket.create_connection=lambda address,**kwargs:connect(('127.0.0.1',PORT),**kwargs)
class Plain:
 def wrap_socket(self,sock,**kwargs):return sock
ssl.create_default_context=lambda:Plain()
c=ns['DirectCDP'](ENDPOINT)
c.command('Page.enable');c.command('Runtime.enable')
with tempfile.TemporaryDirectory() as root:
 ns.update(ROOT=root,TARGET_DIR=root,BROWSER_STATE_PATH=root+'/state.json',CURRENT_TARGET_KEY='fixture',BROWSER_STATE={'live':{}},browser_diagnostic=lambda *a:None,queue_profile_save=lambda:None,profile_save_warning=lambda:None)
 class Session:
  def __getattr__(self,key):return getattr(c,key)
  def __setattr__(self,key,value):setattr(c,key,value)
  def close(self):pass
 ns['CDP']=lambda url:Session()
 target={'id':'fixture','webSocketDebuggerUrl':'local'}
 def run(operation,payload={}):
  with contextlib.redirect_stdout(io.StringIO()) as output:
   ns['execute_request']({'operation':operation,'payload':payload},target)
  return json.loads(output.getvalue())['value']
 rows=[]
 for trial in range(7):
  ns['evaluate'](c,"(() => { document.querySelector('form').reset();window.submissions=0;return true; })()")
  started=time.monotonic()
  page=run('snapshot')
  refs={e['name']:e['ref'] for e in page['elements']}
  run('type',{'ref':refs['Text input'],'text':'Dash form test','deferObservation':True})
  run('type',{'ref':refs['Textarea'],'text':'Testing without submitting','deferObservation':True})
  run('select',{'ref':refs['Dropdown'],'value':'2'})
  run('check',{'ref':refs['Default checkbox'],'checked':True})
  page=run('snapshot')
  elapsed=(time.monotonic()-started)*1000
  values={e['name']:e for e in page['elements']}
  assert values['Text input']['value']=='Dash form test'
  assert values['Textarea']['value']=='Testing without submitting'
  assert values['Dropdown']['value']=='2'
  assert values['Default checkbox']['checked'] is True
  assert ns['evaluate'](c,'window.submissions')==0
  rows.append(round(elapsed,2))
 print(json.dumps({'benchmark':'simple_form_full_controller','trialsMs':rows,'medianMs':statistics.median(rows),'verified':True,'submitted':False}),flush=True)
c.close()
`.replaceAll('PORT',String(cdpPort)).replaceAll('ENDPOINT',JSON.stringify(endpoint))
  .replace('CONTROLLER',JSON.stringify(process.env.BROWSER_CONTROLLER_SOURCE ? readFileSync(process.env.BROWSER_CONTROLLER_SOURCE,'utf8') : CLOUD_BROWSER_CONTROLLER));

 await new Promise<void>((resolve,reject)=>{
  const child=spawn('python3',['-c',code],{stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>process.stderr.write(data));
  child.once('error',reject);child.once('exit',status=>status===0?resolve():reject(Error('Local form benchmark failed')));
 });
} finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
