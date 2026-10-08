/** Disposable provider comparison; never imports user profiles or places orders. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const key=process.env.STEEL_API_KEY;
if(!key) throw Error('Steel key unavailable');
const headers={'steel-api-key':key,'Content-Type':'application/json'};
const created=await fetch('https://api.steel.dev/v1/sessions',{method:'POST',headers,body:JSON.stringify({timeout:120000,inactivityTimeout:60000,useProxy:false,solveCaptcha:false})});
if(!created.ok){const detail=(await created.text()).replaceAll(key,'[redacted]').replace(/https?:[^\s"<>]+/g,'[url]');throw Error(`Steel session creation returned HTTP ${created.status}: ${detail.slice(0,800)}`);}
const session=await created.json() as {id:string};
let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
try {
 const endpoint=`wss://connect.steel.dev?apiKey=${encodeURIComponent(key)}&sessionId=${encodeURIComponent(session.id)}`;
 browser=await chromium.connectOverCDP(endpoint,{timeout:20000});
 const page=await browser.contexts()[0].newPage();
 await page.goto('https://www.ubereats.com/ca/store/the-chicken-nest/Ri3Ha_KLTvOWyyrTh7Ri-w',{waitUntil:'domcontentloaded',timeout:30000});
 const cdp=await page.context().newCDPSession(page);
 const {targetInfo}=await cdp.send('Target.getTargetInfo');
 const code=`import os,json,time\nns={'__name__':'provider_probe'}\nexec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)\n`+String.raw`
ns['browserless_url']=lambda endpoint:endpoint
c=ns['DirectCDP'](os.environ['PROBE_ENDPOINT'])
try:
 c.command('Page.enable');c.command('Runtime.enable')
 ns['visual_cursor']=lambda *args,**kwargs:None
 started=time.monotonic();first=ns['snapshot'](c)
 print(json.dumps({'phase':'snapshot','ms':round((time.monotonic()-started)*1000),'title':first.get('title'),'controls':len(first['elements'])}),flush=True)
 fields=[e for e in first['elements'] if 'Search in' in e['name'] and e['tag']=='input']
 if len(fields)!=1:
  print('COMPARISON_UNAVAILABLE: Store search field absent',flush=True)
 else:
  c.command('Emulation.setFocusEmulationEnabled',{'enabled':True});c.command('Page.bringToFront')
  text='Chicken '*17+'food'
  started=time.monotonic();ns['replace_field_text'](c,fields[0]['ref'],text);typed=time.monotonic()
  last=ns['snapshot'](c);finished=time.monotonic()
  print(json.dumps({'phase':'typing','inputMs':round((typed-started)*1000),'snapshotMs':round((finished-typed)*1000),'totalMs':round((finished-started)*1000),'retained':any(e.get('value')==text for e in last['elements'])}),flush=True)
finally:c.close()
`;
 await new Promise<void>((resolve,reject)=>{
  const child=spawn('python3',['-c',code],{env:{...process.env,PROBE_ENDPOINT:endpoint+'#'+targetInfo.targetId},stdio:['ignore','pipe','pipe'],timeout:75000});
  child.stdout.on('data',data=>process.stdout.write(data));
  // Exceptions can contain URLs with API keys: report status only.
  child.stderr.resume();
  child.once('error',()=>reject(Error('Provider probe process failed')));
  child.once('exit',status=>status===0?resolve():reject(Error(`Provider probe exited ${status}`)));
 });
}finally{
 const released=await fetch(`https://api.steel.dev/v1/sessions/${encodeURIComponent(session.id)}/release`,{method:'POST',headers});
 console.log(JSON.stringify({phase:'release',status:released.status}));
 await browser?.close().catch(()=>{});
}
