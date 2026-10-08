_base_command=LocalCDP.command
def diagnostic_command(self,*args,**kwargs):
 start=time.monotonic()
 result=_base_command(self,*args,**kwargs)
 if time.monotonic()-start>1:print('SLOW',args[0],round(time.monotonic()-start,2),file=__import__('sys').stderr)
 if result.get('exceptionDetails'): print('CDP EXCEPTION',json.dumps(result['exceptionDetails']),file=__import__('sys').stderr)
 return result
LocalCDP.command=diagnostic_command
ns.update(ROOT=d,TARGET_DIR=d,SECRET_KEY_DIR=d+'/keys',BROWSER_STATE_PATH=d+'/state.json',CURRENT_TARGET_KEY='extended-test',BROWSER_STATE={'generation':'local','live':{}},DIAGNOSTICS_ENABLED=False)
with open(ns['target_path']('extended-test'),'w') as h:h.write(target)
# Use Chrome HTTP target endpoints for the multi-tab operations.
port=urllib.parse.urlsplit(endpoint).port
ns['json_request']=lambda path,method='GET':json.loads(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(port)+path,method=method)).read())
# /json/close returns text, unlike the other target routes.
_original_request=ns['json_request']
def targets_request(path,method='GET'):
 if path.startswith('/json/close/'):
  urllib.request.urlopen('http://127.0.0.1:'+str(port)+path).read();return {}
 return _original_request(path,method)
ns['json_request']=targets_request
current={'id':target,'webSocketDebuggerUrl':endpoint+'#'+target}
def op(name,payload={}):
 global current
 print('RUN',name,payload.get('action',''),file=__import__('sys').stderr)
 identity=ns['read_target_id'](ns['target_path']('extended-test'))
 current={'id':identity,'webSocketDebuggerUrl':endpoint+'#'+identity}
 out=io.StringIO()
 with contextlib.redirect_stdout(out):ns['execute_request']({'operation':name,'payload':payload},current)
 return json.loads(out.getvalue())['value']
def ext(action,**kw):return op('extended',{'action':action,**kw})
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  body=b'fixture download' if self.path=='/file.txt' else b'''<title>Browser parity fixture</title><label>Search<input id=q placeholder="Search products"></label><button id=add onclick="this.textContent='Added'">Add to cart</button><button id=right oncontextmenu="event.preventDefault();this.textContent='Right clicked'">Right</button><button id=double ondblclick="this.textContent='Double clicked'">Double</button><button id=dialog onclick="window.confirm('Continue?')">Dialog</button><input type=file aria-label="Upload"><div data-testid="result">Read me</div><iframe src="/frame"></iframe>'''
  if self.path=='/frame':body=b'<button>Frame button</button>'
  self.send_response(200);self.send_header('Content-Type','text/plain' if self.path=='/file.txt' else 'text/html');self.end_headers();self.wfile.write(body)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
url='http://127.0.0.1:'+str(server.server_port)
try:
 op('navigate',{'url':url})
 def query(q):return ext('query',locator=q)['matches']
 # Exercise real delayed DOM changes through the same controller as production.
 # Waiting must use fresh locator reads, never full-page snapshot polling.
 original_snapshot=ns['snapshot']
 def unexpected_snapshot(*args):raise AssertionError('Locator polling took a full-page snapshot')
 ns['snapshot']=unexpected_snapshot
 try:
  page.command('Runtime.evaluate',{'expression':"setTimeout(()=>{const b=document.createElement('button');b.textContent='Delayed ready';document.body.append(b)},400)"})
  rows=ext('query',locator={'role':'button','name':'Delayed ready'},poll={'state':'visible','timeoutMs':5000})['matches']
  assert len(rows)==1 and rows[0]['visible']
  page.command('Runtime.evaluate',{'expression':"const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Delayed ready');b.disabled=true;setTimeout(()=>b.disabled=false,400)"})
  assert ext('query',locator={'role':'button','name':'Delayed ready'},poll={'state':'enabled','timeoutMs':5000})['matches'][0]['enabled']
  page.command('Runtime.evaluate',{'expression':"setTimeout(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Delayed ready').remove(),400)"})
  assert ext('query',locator={'role':'button','name':'Delayed ready'},poll={'state':'hidden','timeoutMs':5000})['matches']==[]
  assert ext('query',locator={'text':'Frame button'},poll={'state':'attached','timeoutMs':3000})['matches']
  print('PASS delayed visible/enabled/hidden locator waits and child frame read without snapshots')
 finally:ns['snapshot']=original_snapshot
 field=query({'label':'Search'})[0]['ref']
 op('type',{'ref':field,'text':'hello'})
 op('press',{'ref':field,'key':'ControlOrMeta+End'});op('type',{'ref':field,'text':' world','append':True})
 assert ext('evaluate',expression="document.querySelector('#q').value")['value']=='hello world'
 assert query({'testId':'result'})[0]['text']=='Read me'
 assert len(query({'text':'Frame button'}))==1
 for label,expected,count,button in [('Right','Right clicked',1,'right'),('Double','Double clicked',2,'left')]:
  ref=query({'role':'button','name':label})[0]['ref'];op('click',{'ref':ref,'clickCount':count,'button':button});assert query({'role':'button','name':expected})
 print('PASS locators, iframe, fill/append/shortcuts, right and double click')
 try:ext('evaluate',expression="document.body.innerHTML='bad'")
 except RuntimeError:pass
 else:raise AssertionError('Mutation through evaluate was allowed')
 upload=query({'css':'input[type=file]'})[0]['ref'];ext('upload',ref=upload,files=[{'name':'hello.txt','base64':base64.b64encode(b'hello').decode()}])
 assert ext('evaluate',expression="document.querySelector('input[type=file]').files[0].name")['value']=='hello.txt'
 assert base64.b64decode(ext('download',url=url+'/file.txt')['base64'])==b'fixture download'
 ext('clipboard_write',text='clipboard fixture');assert ext('clipboard_read')['text']=='clipboard fixture'
 print('PASS read-only guard, upload, download, task clipboard')
 first=ext('tabs_list')['tabs'][0]['id'];tabs=ext('tabs_new')['tabs'];second=next(t['id'] for t in tabs if t['id']!=first)
 ext('tabs_select',id=second);op('navigate',{'url':url+'/other'});ext('reload');op('navigate',{'url':url+'/another'});op('back');ext('forward')
 assert op('snapshot')['url'].endswith('/another')
 ext('tabs_close',id=second);assert len(ext('tabs_list')['tabs'])==1
 try:ext('tabs_select',id='another-runs-tab')
 except RuntimeError:pass
 else:raise AssertionError('Foreign tab allowed')
 print('PASS tab create/select/close/isolation and navigation')
 ref=query({'role':'button','name':'Dialog'})[0]['ref']
 result=op('click',{'ref':ref});assert 'Continue?' in result['text'],result
 ext('dialog',accept=False);assert op('snapshot')['title']=='Browser parity fixture'
 print('PASS dialog open/dismiss; ALL browser parity fixtures passed')
finally:server.shutdown()
