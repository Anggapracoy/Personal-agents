import sys
ns.update(ROOT=d,TARGET_DIR=d,SECRET_KEY_DIR=d+'/keys',BROWSER_STATE_PATH=d+'/state.json',CURRENT_TARGET_KEY='keyboard-test',BROWSER_STATE={'generation':'local','live':{}},DIAGNOSTICS_ENABLED=False)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  body=b'''<!doctype html><title>Keyboard input measurement</title><h1>Keyboard input</h1><button id="target">Keyboard target</button><output id="result"></output><script>window.record={text:'',events:0,trusted:true};document.addEventListener('keydown',e=>{record.events++;record.trusted&&=e.isTrusted;if(/^[a-z]$/.test(e.key)){record.text+=e.key;document.querySelector('output').textContent=record.text;}});document.addEventListener('keyup',e=>{record.events++;record.trusted&&=e.isTrusted;});</script>'''
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
current={'id':target,'webSocketDebuggerUrl':endpoint+'#'+target}
def op(name,payload):
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
    page.command('Runtime.evaluate',{'expression':"record={text:'',events:0,trusted:true};document.querySelector('output').textContent=''"})
    snapshots=0;command_counts.clear();value=True
   elif name=='state':
    value=page.command('Runtime.evaluate',{'expression':'record','returnByValue':True})['result']['value'];value['snapshots']=snapshots;value['cdpCommands']=sum(command_counts.values())
   else:value=op(name,message.get('payload',{}))
   print(json.dumps({'value':value}),flush=True)
  except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
finally:server.shutdown()
