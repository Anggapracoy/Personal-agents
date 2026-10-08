import sys
ns.update(ROOT=d,TARGET_DIR=d,SECRET_KEY_DIR=d+'/keys',BROWSER_STATE_PATH=d+'/state.json',CURRENT_TARGET_KEY='budget-test',BROWSER_STATE={'generation':'local','live':{}},DIAGNOSTICS_ENABLED=False)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path.startswith('/frame'):body='<p>Embedded size guide</p><button>Frame control</button>'
  else:body='''<h1>Keyboard game</h1><div id="modal" aria-modal="true" style="display:none"><button>Close</button></div><output></output><iframe title="Size guide" src="/frame" width="300" height="100"></iframe>'''+''.join('<iframe src="/frame?'+str(i)+'" style="width:1px;height:1px"></iframe>' for i in range(40))+'''<script>window.record={text:'',trusted:true};document.addEventListener('keydown',e=>{record.trusted&&=e.isTrusted;if(/^[A-Z]$/.test(e.key))record.text+=e.key;});</script>'''
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body.encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
current={'id':target,'webSocketDebuggerUrl':endpoint+'#'+target}
def op(name,payload={}):
 out=io.StringIO()
 with contextlib.redirect_stdout(out):ns['execute_request']({'operation':name,'payload':payload},current)
 return json.loads(out.getvalue())['value']
op('navigate',{'url':'http://127.0.0.1:'+str(server.server_port)})
time.sleep(.5)
print(json.dumps({'ready':True}),flush=True)
try:
 for line in sys.stdin:
  try:
   name=json.loads(line)['operation']
   if name=='stop':print(json.dumps({'value':True}),flush=True);break
   # Emulate 50 ms CDP network RTT without paid remote browsers.
   original=LocalCDP.command
   def latency(self,*a,**kw):time.sleep(.05);return original(self,*a,**kw)
   LocalCDP.command=latency
   original_batch=LocalCDP.read_commands
   def batch_latency(self,*a,**kw):time.sleep(.05);return original_batch(self,*a,**kw)
   LocalCDP.read_commands=batch_latency
   samples=[]
   for i in range(3):
    command_counts.clear();started=time.monotonic();snap=op('snapshot');samples.append({'ms':round((time.monotonic()-started)*1000,1),'commands':sum(command_counts.values())})
   LocalCDP.command=original
   LocalCDP.read_commands=original_batch
   typing_error=None
   try:op('keyboard_type',{'text':'CRANE','deferObservation':True})
   except Exception as error:typing_error=str(error)
   record=page.command('Runtime.evaluate',{'expression':'record','returnByValue':True})['result']['value']
   page.command('Runtime.evaluate',{'expression':"document.querySelector('#modal').style.display='block'"})
   blocked=False
   try:op('keyboard_type',{'text':'X','deferObservation':True})
   except ns['PreDispatchError']:blocked=True
   page.command('Runtime.evaluate',{'expression':"document.querySelector('#modal').style.display='none';let field=document.createElement('input');document.body.append(field);field.focus()"})
   field_blocked=False
   try:op('keyboard_type',{'text':'X','deferObservation':True})
   except ns['PreDispatchError']:field_blocked=True
   report={'scope':'Actual Chromium + controller, local site, simulated 50ms CDP command RTT. No model/E2B/Browserless.','samples':samples,'typingError':typing_error,**record,'visibleModalBlocked':blocked,'fieldBlocked':field_blocked,'frameTextPreserved':'Embedded size guide' in snap['text'],'frameControlPreserved':any(e['name']=='Frame control' for e in snap['elements'])}
   if test_mode=='after':
    original_reads=LocalCDP.read_commands
    def stalled(self,commands,*args,**kwargs):
     if any(c['method']=='Accessibility.getFullAXTree' for c in commands):
      time.sleep(kwargs.get('timeout',20));raise RuntimeError('CDP command accessibility timed out')
     return original_reads(self,commands,*args,**kwargs)
    LocalCDP.read_commands=stalled
    started=time.monotonic();bounded=ns['snapshot'](page);report['stalledSnapshotMs']=round((time.monotonic()-started)*1000,1)
    LocalCDP.read_commands=original_reads
    report['stalledControlsPreserved']=any(e['name']=='Frame control' for e in bounded['elements'])
    report['stalledValuesRedacted']=all('value' not in e for e in bounded['elements'])
   print(json.dumps({'value':report}),flush=True)
  except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
finally:server.shutdown()
