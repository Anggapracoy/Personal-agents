/** Disposable diagnostic: time Chromium startup and retain public browser logs. */
import {Sandbox} from 'e2b';
import {mkdirSync,writeFileSync} from 'node:fs';
const output=process.env.COMPARISON_OUTPUT_DIR;
if(!output||!process.env.E2B_TEMPLATE_ID)throw new Error('Diagnostic configuration required');
mkdirSync(output,{recursive:true});
const sandbox=await Sandbox.create(process.env.E2B_TEMPLATE_ID,{timeoutMs:120000,network:{allowPublicTraffic:false},metadata:{purpose:'browser-startup-diagnostic'}});
try{
 const result=await sandbox.commands.run(`python3 - <<'PY'
import subprocess,time,tempfile,os,json,signal
rows=[]
for i in range(3):
 profile=tempfile.mkdtemp(prefix='dash-startup-');logfile=profile+'/stderr.log'
 start=time.monotonic()
 with open(logfile,'w') as log:
  child=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','about:blank'],stdout=log,stderr=log,start_new_session=True)
  try:
   while not os.path.exists(profile+'/DevToolsActivePort') and time.monotonic()-start<15:
    if child.poll() is not None:break
    time.sleep(.02)
   rows.append({'index':i,'elapsedMs':(time.monotonic()-start)*1000,'ready':os.path.exists(profile+'/DevToolsActivePort'),'stderr':open(logfile).read()[-5000:]})
  finally:
   try:os.killpg(child.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:child.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL)
print(json.dumps(rows))
PY`,{timeoutMs:65000});
 const rows=JSON.parse(result.stdout.trim());
 writeFileSync(output+'/results.json',JSON.stringify(rows,null,2));
 console.log(JSON.stringify(rows));
}finally{writeFileSync(output+'/cleanup.json',JSON.stringify({sandboxKilled:await sandbox.kill()}));}
