/** Explicitly opt-in one-session observation profile. No model or production DB. */
import {BrowserlessCloudBrowserProvider} from '../lib/harness/browser/cloud';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
import {mkdirSync,writeFileSync} from 'node:fs';
if(process.env.ALLOW_SNAPSHOT_CLOUD_PROBE!=='1')throw Error('Explicit paid-probe opt-in required');
const target='snapshot-probe-'+crypto.randomUUID(),user=target+'@example.invalid';
const provider=new BrowserlessCloudBrowserProvider(target,undefined,user);let sandbox:any;const rows:any[]=[];const root='/tmp/dash-snapshot-cloud';mkdirSync(root,{recursive:true});
try{
 await provider.warm(user,true);sandbox=(provider as any).account.sandbox;
 const path='/tmp/dash-snapshot-cloud-probe.py';
 const python=`import os,json,sys,time
ns={'__name__':'snapshot_probe'}
exec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)
original=ns['browserless_api']
def guard(path,method='GET',body=None):
 if method=='POST' and '/stealth/bql' in path:
  marker='/tmp/dash-probe-created-session'
  if os.path.exists(marker) or os.environ.get('ALLOW_FIRST_SESSION')!='1': raise RuntimeError('probe_allows_only_one_session')
  open(marker,'w').close()
 return original(path,method,body)
ns['browserless_api']=guard
ns['main']()
`;
 await sandbox.files.write(path,python);
 const envs={BROWSERLESS_API_TOKEN:process.env.BROWSERLESS_API_TOKEN!,BROWSERLESS_HOST:process.env.BROWSERLESS_HOST||'production-sfo.browserless.io',BROWSERLESS_PROFILE:'dash-dev-'+(provider as any).account.userHash,BROWSERLESS_SESSION_TIMEOUT_MS:'120000',BROWSERLESS_PROXY_COUNTRY:'ca'};
 const invoke=async(operation:string,payload:Record<string,unknown>,first=false)=>{
  const start=performance.now();const result=await sandbox.commands.run('python3 '+path,{timeoutMs:60000,envs:{...envs,ALLOW_FIRST_SESSION:first?'1':'0',DASH_BROWSER_REQUEST:JSON.stringify({operation,targetKey:target,payload})}});
  const spans:any[]=[];let value:any;
  for(const line of result.stdout.split('\n')){if(line.startsWith('DASH_DIAGNOSTIC ')){const d=JSON.parse(line.slice(16));if(d.stage==='operation_phases')spans.push(...d.spans);}else if(line.startsWith('{')){const d=JSON.parse(line);if(!d.ok)throw Error(d.error??'Probe failed');value=d.value;}}
  const row={operation,elapsedMs:performance.now()-start,elements:value?.elements?.length,spans};rows.push(row);writeFileSync(root+'/results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(row));return value;
 };
 await invoke('navigate',{url:'https://www.nytimes.com/games/wordle/index.html'},true);
 for(let i=0;i<3;i++)await invoke('snapshot',{});
 await invoke('close_browser',{});
 console.log('Closed isolated Browserless session');
}finally{
 if(sandbox){
  // Ensure failure cleanup closes the same isolated session without replacement.
  await sandbox.commands.run('python3 /tmp/dash-snapshot-cloud-probe.py',{timeoutMs:15000,envs:{BROWSERLESS_API_TOKEN:process.env.BROWSERLESS_API_TOKEN!,BROWSERLESS_HOST:process.env.BROWSERLESS_HOST||'production-sfo.browserless.io',BROWSERLESS_PROFILE:'dash-dev-'+(provider as any).account.userHash,DASH_BROWSER_REQUEST:JSON.stringify({operation:'close_browser',targetKey:target,payload:{}}),ALLOW_FIRST_SESSION:'0'}}).catch(()=>{});
  await sandbox.kill();console.log('Killed isolated controller');
 }
}
