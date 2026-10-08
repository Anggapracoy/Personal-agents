/** Isolated lower-bound experiment: unchanged native observation/input engine,
 * disposable cloud Chromium, no account profile, login, cart or submission. */
import {Sandbox} from 'e2b';
import {mkdirSync,writeFileSync} from 'node:fs';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
const output=process.env.COMPARISON_OUTPUT_DIR;
if(!output||!process.env.E2B_TEMPLATE_ID)throw new Error('Diagnostic output and existing template required');
mkdirSync(output,{recursive:true});
const started=performance.now();
const sandbox=await Sandbox.create(process.env.E2B_TEMPLATE_ID,{timeoutMs:180000,network:{allowPublicTraffic:false},metadata:{purpose:'public-browser-colocation-probe'}});
try {
 const startup=await sandbox.commands.run("chromium --version",{timeoutMs:10000});
 const server=await sandbox.commands.run("chromium --headless=new --no-sandbox --disable-dev-shm-usage --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/tmp/dash-browser-colocation --no-first-run --no-default-browser-check about:blank",{background:true,timeoutMs:150000});
 const controller=CLOUD_BROWSER_CONTROLLER.replace('self.sock = ssl.create_default_context().wrap_socket(socket.create_connection((url.hostname, 443), timeout=10), server_hostname=url.hostname)','self.sock = socket.create_connection((url.hostname, url.port), timeout=10)').replace('PooledCDP(cdp.endpoint, channel="visual")','DirectCDP(cdp.endpoint)');
 await sandbox.files.write('/tmp/dash-controller.py',controller);
 await sandbox.files.write('/tmp/dash-colocation-probe.py',String.raw`
import json,os,time,urllib.request,contextlib,io
__file__='/tmp/dash-controller.py'
source=open('/tmp/dash-controller.py').read().split('if __name__ == "__main__":')[0]
exec(compile(source,'/tmp/dash-controller.py','exec'))
ROOT='/tmp/dash-colocation-state';TARGET_DIR=ROOT+'/targets';LOCK_PATH=ROOT+'/controller.lock';SECRET_KEY_DIR=ROOT+'/secrets'
os.makedirs(TARGET_DIR,exist_ok=True)
for attempt in range(100):
 try:
  endpoint=json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/version',timeout=2))['webSocketDebuggerUrl'];break
 except Exception: time.sleep(.1)
else: raise RuntimeError('Isolated Chromium did not start')
def browserless_url(url):
 p=urllib.parse.urlparse(url)
 if p.scheme!='ws' or p.hostname!='127.0.0.1' or p.port!=9222: raise RuntimeError('Only isolated local CDP allowed')
 return url
CDP=DirectCDP
BROWSER_STATE={'generation':'isolated-colocation','expiresAt':time.time()+180,'ws':endpoint,'live':{}}
BROWSER_STATE_PATH=ROOT+'/browser.json'
CURRENT_TARGET_KEY='isolated-public-research';DIAGNOSTICS_ENABLED=False
BROWSER_CONNECTION=CDP(endpoint)
def queue_profile_save(): pass
def profile_save_warning(): return None
rows=[]
def run(operation,payload):
 request={'operation':operation,'payload':payload,'targetKey':CURRENT_TARGET_KEY}
 begin=time.perf_counter()
 target=choose_target(CURRENT_TARGET_KEY,operation=='navigate')
 with contextlib.redirect_stdout(io.StringIO()) as output: execute_request(request,target)
 values=[json.loads(line)['value'] for line in output.getvalue().splitlines() if line.startswith('{') and json.loads(line).get('ok')]
 if not values: raise RuntimeError('No controller result')
 value=values[-1];elapsed=(time.perf_counter()-begin)*1000
 rows.append({'operation':operation,'elapsedMs':elapsed,'value':value})
 return value
try:
 for url in ['https://www.ikea.com/us/en/p/micke-desk-white-80213074/','https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-s29416758/']:
  page=run('navigate',{'url':url})
  cookies=[e for e in page['elements'] if e.get('role')=='button' and e.get('name')=='Ok']
  if len(cookies)==1: page=run('click',{'ref':cookies[0]['ref'],'observeOutcome':False})
  for attempt in range(3):
   matches=[e for e in page['elements'] if e.get('role')=='tab' and e.get('name')=='Measurements']
   if matches: break
   page=run('wait',{'milliseconds':1000})
  if len(matches)!=1: raise RuntimeError('Measurements tab not uniquely available')
  run('click',{'ref':matches[0]['ref'],'observeOutcome':False})
  for i in range(3): run('snapshot',{})
 print(json.dumps({'rows':rows,'chrome':json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/version'))['Browser']}))
finally:
 try:BROWSER_CONNECTION.command('Browser.close')
 finally:BROWSER_CONNECTION.close()
`);
 const preparedMs=performance.now()-started;
 const result=await sandbox.commands.run('python3 /tmp/dash-colocation-probe.py',{timeoutMs:120000});
 const parsed=JSON.parse(result.stdout.trim());
 writeFileSync(`${output}/results.json`,JSON.stringify({preparedMs,elapsedMs:performance.now()-started,version:startup.stdout.trim(),...parsed},null,2));
 console.log(JSON.stringify({preparedMs,elapsedMs:performance.now()-started,rows:parsed.rows.map((r:any)=>({operation:r.operation,elapsedMs:r.elapsedMs,title:r.value?.title,elements:r.value?.elements?.length}))}));
 await server.kill().catch(()=>undefined);
} catch(error) {
 // SDK errors may carry transport headers. Retain only bounded process output.
 const e=error as {stdout?:string;stderr?:string};
 writeFileSync(`${output}/failure.json`,JSON.stringify({stdout:e.stdout?.slice(-1500),stderr:e.stderr?.slice(-1500)},null,2));
 console.log('Isolated colocation probe failed; bounded diagnostics saved.');
} finally {
 const killed=await sandbox.kill();writeFileSync(`${output}/cleanup.json`,JSON.stringify({sandboxKilled:killed}));
}
