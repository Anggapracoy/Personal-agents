import sys
_base_command=LocalCDP.command
def measured_command(self,method,*args,**kwargs):
 start=time.monotonic()
 # Production Chrome runs on Linux. Normalize its native shortcut codes for
 # the local macOS browser; both benchmark variants use this same adapter.
 if sys.platform=='darwin' and method=='Input.dispatchKeyEvent' and args:
  params=dict(args[0]);params.pop('nativeVirtualKeyCode',None)
  if params.get('key')=='a' and params.get('modifiers')==2:
   params['modifiers']=4
   if params.get('type')=='keyDown':params['commands']=['selectAll']
  args=(params,*args[1:])
 try:return _base_command(self,method,*args,**kwargs)
 finally:
  if time.monotonic()-start>1:print('SLOW',method,round(time.monotonic()-start,2),args if method=='Input.dispatchKeyEvent' else '',file=sys.stderr)
LocalCDP.command=measured_command
ns.update(ROOT=d,TARGET_DIR=d,SECRET_KEY_DIR=d+'/keys',BROWSER_STATE_PATH=d+'/state.json',CURRENT_TARGET_KEY='workflow-test',BROWSER_STATE={'generation':'local','live':{}},DIAGNOSTICS_ENABLED=False)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  body='<!doctype html><title>Workflow timing fixture</title><h1>Workflow fixture</h1>'+''.join('<label>Field '+str(i)+'<input autocomplete=off spellcheck=false></label>' for i in range(5))+'<div id="ready"></div><script>window.clicks=0;window.timer=null;</script>'
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body.encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
current={'id':target,'webSocketDebuggerUrl':endpoint+'#'+target}
def op(name,payload={}):
 out=io.StringIO()
 with contextlib.redirect_stdout(out):ns['execute_request']({'operation':name,'payload':payload},current)
 return json.loads(out.getvalue())['value']
original_snapshot=ns['snapshot'];snapshots=0
def counted_snapshot(*args,**kwargs):
 global snapshots
 snapshots+=1
 return original_snapshot(*args,**kwargs)
ns['snapshot']=counted_snapshot
op('navigate',{'url':'http://127.0.0.1:'+str(server.server_port)})
print(json.dumps({'ready':True}),flush=True)
try:
 for line in sys.stdin:
  try:
   message=json.loads(line);name=message['operation']
   if name=='stop':
    print(json.dumps({'value':True}),flush=True);break
   if name=='reset':
    expr="clearTimeout(window.timer);window.clicks=0;document.querySelectorAll('input').forEach(e=>e.value='');document.querySelector('#ready').innerHTML='';"
    if message['payload']['scenario'] in ('fixed_wait','missing_target'):expr+="window.timer=setTimeout(()=>{const b=document.createElement('button');b.textContent='Ready';b.onclick=()=>window.clicks++;document.querySelector('#ready').append(b)},600);"
    page.command('Runtime.evaluate',{'expression':expr})
    snapshots=0;command_counts.clear();value=True
   elif name=='state':
    value=page.command('Runtime.evaluate',{'expression':"({values:[...document.querySelectorAll('input')].map(e=>e.value),ready:!!document.querySelector('#ready button'),clicks:window.clicks})",'returnByValue':True})['result']['value'];value['snapshots']=snapshots;value['cdpCommands']=sum(command_counts.values())
   else:value=op(name,message.get('payload',{}))
   print(json.dumps({'value':value}),flush=True)
  except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
finally:server.shutdown()
