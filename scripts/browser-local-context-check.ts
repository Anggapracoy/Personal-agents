/** Local Chrome regression check; no Browserless, sandbox, or external sites. */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const server=createServer((req,res)=>{
 res.setHeader('Content-Type','text/html');
 const port=(server.address() as {port:number}).port;
 res.end(req.url==='/child' ? '<label>Child field<input></label>' : `<title>Local browser fixture</title><label>Main field<input></label><label>Address<input></label><label>Notes<input></label><iframe src="/child"></iframe><iframe src="http://localhost:${port}/child"></iframe>`);
});
await new Promise<void>(resolve=>server.listen(0,resolve));
const port=(server.address() as {port:number}).port;
const reserve=createServer();await new Promise<void>(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const cdpPort=(reserve.address() as {port:number}).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));
const browser=await chromium.launch({headless:true,args:[`--remote-debugging-port=${cdpPort}`,'--site-per-process']});
try {
 const page=await browser.newPage();await page.goto(process.env.BROWSER_LOCAL_PROBE_URL || `http://127.0.0.1:${port}/`);
 const targets=await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json() as Array<{type:string;id:string}>;
 const target=targets.find(t=>t.type==='page')!;
 const version=await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json() as {webSocketDebuggerUrl:string};
 const endpoint=version.webSocketDebuggerUrl.replace('ws:','wss:')+'#'+target.id;
 let code=String.raw`
import json,ssl,socket,time
ns={'__name__':'local_test'}
CONTROLLER_SOURCE=CONTROLLER
exec(CONTROLLER_SOURCE,ns)
# The production WebSocket framing/dispatch runs unchanged; this fixture only
# replaces its Browserless TLS handshake with the loopback Chrome connection.
ns['browserless_url']=lambda endpoint:endpoint
connect=socket.create_connection
socket.create_connection=lambda address,**kwargs:connect(('127.0.0.1',PORT),**kwargs)
class Plain:
 def wrap_socket(self,sock,**kwargs):return sock
ssl.create_default_context=lambda:Plain()
c=ns['DirectCDP'](ENDPOINT)
c.command('Page.enable');c.command('Runtime.enable')
first=ns['snapshot'](c)
assert sum(e['name']=='Main field' for e in first['elements'])==1
assert sum(e['name']=='Child field' for e in first['elements'])==2
assert not first['warnings'],first['warnings']
contexts=ns['frame_contexts'](c);assert len(contexts)==3
assert any(x.get('sessionId') for x in contexts),'Cross-process iframe missing'
main=next(e for e in first['elements'] if e['name']=='Main field')
# Execute the production ordinary/secure typing branch against real Chrome.
source=CONTROLLER_SOURCE
branch=source[source.index('        elif operation in ("type", "secure_type"):'):source.index('        elif operation == "select":')]
branch=branch.replace('        elif ', '        if ', 1)
ns['probe_cdp']=c
exec('def probe_type(payload, operation="type"):\n    cdp=probe_cdp\n'+ '\n'.join(line[4:] for line in branch.splitlines())+'\n    return value',ns)
ns['visual_cursor']=lambda *args,**kwargs:None
original_snapshot=ns['snapshot']
captures=[]
def counted_snapshot(cdp):
 captures.append(True)
 return original_snapshot(cdp)
ns['snapshot']=counted_snapshot
fill_started=time.monotonic()
for name,text in [('Main field','first'),('Address','second'),('Notes','third')]:
 field=next(e for e in first['elements'] if e['name']==name)
 assert ns['probe_type']({'ref':field['ref'],'text':text,'deferObservation':True})=={'observationDeferred':True}
print(json.dumps({'benchmark':'three_field_fill','ms':round((time.monotonic()-fill_started)*1000,2)}),flush=True)
assert not captures,'Deferred ordinary fills took a full snapshot'
filled=ns['snapshot'](c)
assert len(captures)==1
for name,text in [('Main field','first'),('Address','second'),('Notes','third')]:
 assert next(e for e in filled['elements'] if e['name']==name)['value']==text
ns['snapshot']=original_snapshot

# Real native input into a textarea below a scrollable dialog's viewport.
# Clicking its unscrolled coordinates lands outside and dismisses the dialog.
ns['evaluate'](c,"""(() => {
 const dialog=document.createElement('div');dialog.id='note-dialog';dialog.setAttribute('role','dialog');
 dialog.style.cssText='position:fixed;left:200px;top:80px;width:500px;height:280px;overflow:auto;background:white;z-index:99999';
 dialog.innerHTML='<div style="height:1000px">Product options</div><label>Kitchen instructions<textarea></textarea></label>';
 document.body.append(dialog);
 window.addEventListener('pointerdown',event=>{
   if(!dialog.isConnected)return;
   const r=dialog.getBoundingClientRect();
   if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.remove();
 });return true;
})()""")
modal=ns['snapshot'](c)
note=next(e for e in modal['elements'] if e['name']=='Kitchen instructions')
ns['probe_type']({'ref':note['ref'],'text':'Please cook medium','deferObservation':True})
assert ns['evaluate'](c,"Boolean(document.querySelector('#note-dialog'))"),'Fill dismissed the dialog'
assert ns['evaluate'](c,"document.querySelector('#note-dialog textarea').value")=='Please cook medium'
ns['evaluate'](c,"document.querySelector('#note-dialog').remove()")
print('PASS local Chrome: offscreen kitchen note scrolled and filled without dismissing dialog',flush=True)

ns['evaluate'](c,"document.querySelector('input').value='fresh'")
second=ns['snapshot'](c)
assert next(e for e in second['elements'] if e['name']=='Main field')['value']=='fresh'
assert next(e for e in second['elements'] if e['name']=='Main field')['ref']==main['ref']
# New controls in multiple frames must retain globally unique references even
# when the counter read/write travels with the observation itself.
ns['evaluate'](c,"(() => { const input=document.createElement('input'); input.setAttribute('aria-label','New main field'); document.body.append(input); return true; })()")
expanded=ns['snapshot'](c)
refs=[e['ref'] for e in expanded['elements']]
assert len(refs)==len(set(refs)),'Cross-frame reference collision'
assert next(e for e in expanded['elements'] if e['name']=='Main field')['ref']==main['ref']
ns['evaluate'](c,"(() => {const field=document.querySelector('input');field.setAttribute('data-decision-feed-secret','true');field.value='do-not-expose';return true;})()")
redacted=ns['snapshot'](c)
assert 'do-not-expose' not in json.dumps(redacted)
ns['evaluate'](c,"document.querySelectorAll('iframe').forEach(f=>f.remove())")
third=ns['snapshot'](c)
assert not any(e['name']=='Child field' for e in third['elements'])
assert len(ns['frame_contexts'](c))==1
c.command('Page.navigate',{'url':URL+'?second'})
ns['ready'](c)
last=ns['snapshot'](c)
assert last['documentId']!=first['documentId']
assert sum(e['name']=='Child field' for e in last['elements'])==2
assert not last['warnings'],last['warnings']
c.close()
print('PASS local Chrome: fresh values, stable refs, local and cross-process frames, removal, navigation')
`.replaceAll('PORT',String(cdpPort)).replaceAll('ENDPOINT',JSON.stringify(endpoint)).replaceAll('URL',JSON.stringify(`http://127.0.0.1:${port}/`)).replace('CONTROLLER_SOURCE=CONTROLLER',`CONTROLLER_SOURCE=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}`);
 if(process.env.BROWSER_LOCAL_PROBE_URL){
  const start=code.indexOf("first=ns['snapshot'](c)");
  code=code.slice(0,start)+String.raw`
ns['visual_cursor']=lambda *args,**kwargs:None
started=time.monotonic();first=ns['snapshot'](c)
print(json.dumps({'phase':'initial_snapshot','ms':round((time.monotonic()-started)*1000)}),flush=True)
fields=[e for e in first['elements'] if 'Search in' in e['name'] and e['tag']=='input']
assert len(fields)==1, json.dumps({'message':'Expected public store search field unavailable','title':first.get('title'),'controls':[e['name'] for e in first['elements']][:20]})
c.command('Emulation.setFocusEmulationEnabled',{'enabled':True});c.command('Page.bringToFront')
text='Chicken '*17+'food'
started=time.monotonic();ns['replace_field_text'](c,fields[0]['ref'],text);typed=time.monotonic()
last=ns['snapshot'](c);finished=time.monotonic()
assert any(e.get('value')==text for e in last['elements']),'Typing was not retained'
print(json.dumps({'phase':'ordinary_typing','inputMs':round((typed-started)*1000),'snapshotMs':round((finished-typed)*1000),'totalMs':round((finished-started)*1000),'characters':len(text),'retained':True}),flush=True)
c.close()
`;
 }
 await new Promise<void>((resolve,reject)=>{
  const child=spawn('python3',['-c',code],{stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>process.stderr.write(data));
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Local browser check failed')));
 });
} finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
