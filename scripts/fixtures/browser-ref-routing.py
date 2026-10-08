import sys
ns.update(ROOT=d,TARGET_DIR=d,SECRET_KEY_DIR=d+'/keys',BROWSER_STATE_PATH=d+'/state.json',CURRENT_TARGET_KEY='ref-test',BROWSER_STATE={'generation':'local','live':{}},DIAGNOSTICS_ENABLED=False)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path.startswith('/frame'):body='<p>Size guide</p><button onclick="this.dataset.clicks=String((+this.dataset.clicks||0)+1)">Frame control</button>'
  else:body='<h1>Page keyboard</h1><button id="main" onclick="this.dataset.clicks=String((+this.dataset.clicks||0)+1)">Main control</button><iframe title="Size guide" src="/frame" width="300" height="100"></iframe>'+''.join('<iframe src="/frame?'+str(i)+'" style="width:1px;height:1px"></iframe>' for i in range(40))
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body.encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
current={'id':target,'webSocketDebuggerUrl':endpoint+'#'+target}
def op(name,payload={}):
 out=io.StringIO()
 with contextlib.redirect_stdout(out):ns['execute_request']({'operation':name,'payload':payload},current)
 return json.loads(out.getvalue())['value']
op('navigate',{'url':'http://127.0.0.1:'+str(server.server_port)})
time.sleep(.3)
snap=op('snapshot');main_ref=next(e['ref'] for e in snap['elements'] if e['name']=='Main control');child_ref=next(e['ref'] for e in snap['elements'] if e['name']=='Frame control')
print(json.dumps({'ready':True}),flush=True)
try:
 for line in sys.stdin:
  try:
   name=json.loads(line)['operation']
   if name=='stop':print(json.dumps({'value':True}),flush=True);break
   original=LocalCDP.command;original_batch=LocalCDP.read_commands
   def latency(self,*a,**kw):time.sleep(.05);return original(self,*a,**kw)
   def batch_latency(self,*a,**kw):time.sleep(.05);return original_batch(self,*a,**kw)
   LocalCDP.command=latency;LocalCDP.read_commands=batch_latency
   samples=[]
   for ref in [main_ref,child_ref,main_ref,child_ref,main_ref]:
    command_counts.clear();started=time.monotonic();result=op('preflight_locator',{'locator':{'ref':ref},'fullPage':False})
    assert len(result['matches'])==1
    samples.append({'ms':round((time.monotonic()-started)*1000,1),'commands':sum(command_counts.values()),'worldDiscovery':command_counts.get('Page.createIsolatedWorld',0),'target':'main' if ref==main_ref else 'iframe'})
   LocalCDP.command=original;LocalCDP.read_commands=original_batch
   op('click',{'ref':main_ref,'deferObservation':True});op('click',{'ref':child_ref,'deferObservation':True})
   contexts=ns['frame_contexts'](page)
   clicks=[ns['evaluate_context'](page,"Array.from(document.querySelectorAll('button')).reduce((n,e)=>n+(+e.dataset.clicks||0),0)",c) for c in contexts]
   main_once=clicks[0]==1;child_once=sum(clicks[1:])==1
   page.command('Runtime.evaluate',{'expression':"document.querySelector('#main').remove()"})
   stale_rejected=False
   try:op('preflight_locator',{'locator':{'ref':main_ref},'fullPage':False})
   except Exception:stale_rejected=True
   else:stale_rejected=not ns['extended_query'](page,{'ref':main_ref})
   print(json.dumps({'value':{'scope':'Real Chromium/controller; 40 tracking frames and a visible iframe; simulated 50ms CDP RTT; no cloud credits','samples':samples,'staleRejected':stale_rejected,'mainClickedOnce':main_once,'frameClickedOnce':child_once,'frameControlPreserved':True}}),flush=True)
  except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
finally:server.shutdown()
