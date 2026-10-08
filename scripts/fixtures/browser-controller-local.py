import socket,urllib.parse,os,base64,tempfile,json,contextlib,io,time,ssl,subprocess,threading
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
ns={'__name__':'local_fixture'}
exec(controller,ns)
Base=ns['DirectCDP']
command_counts={}
class LocalCDP(Base):
 def command(self,method,*args,**kwargs):
  command_counts[method]=command_counts.get(method,0)+1
  if method=='Accessibility.getPartialAXTree' and args and 'backendNodeId' in args[0]:command_counts['backendIdentityReads']=command_counts.get('backendIdentityReads',0)+1
  return super().command(method,*args,**kwargs)
 def read_commands(self,commands,*args,**kwargs):
  for command in commands:command_counts[command['method']]=command_counts.get(command['method'],0)+1
  return super().read_commands(commands,*args,**kwargs)
 def frame_values(self,kind,contexts,counter=None):
  command_counts['frame_values']=command_counts.get('frame_values',0)+1
  command_counts['Runtime.evaluate']=command_counts.get('Runtime.evaluate',0)+len(contexts)
  return super().frame_values(kind,contexts,counter)
 def reference_query(self,contexts,ref):
  command_counts['reference_query']=command_counts.get('reference_query',0)+1
  command_counts['Runtime.evaluate']=command_counts.get('Runtime.evaluate',0)+len(contexts)
  return super().reference_query(contexts,ref)
 def __init__(self,endpoint):
  u=urllib.parse.urlparse(endpoint);self.sock=socket.create_connection((u.hostname,u.port));self.next_id=1;self.events=[];self.attached_targets={};self.page_session=None
  key=base64.b64encode(os.urandom(16)).decode()
  self.sock.sendall(('GET '+u.path+' HTTP/1.1\r\nHost: '+u.netloc+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
  header=b''
  while b'\r\n\r\n' not in header:header+=self.sock.recv(1)
  assert header.startswith(b'HTTP/1.1 101'),header
  if u.fragment:self.page_session=self.command('Target.attachToTarget',{'targetId':u.fragment,'flatten':True})['sessionId']
# Reuse transport as the production pool does. Test real controller operations.
connections={}
def connect(endpoint):
 if endpoint not in connections:connections[endpoint]=LocalCDP(endpoint)
 return connections[endpoint]
LocalCDP.close=lambda self:None
ns['CDP']=connect
root=connect(endpoint)
target=root.command('Target.createTarget',{'url':'about:blank'})['targetId']
page=connect(endpoint+'#'+target)
ns['checkpoint_profile']=lambda *args:None
with tempfile.TemporaryDirectory() as d:
 subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',d+'/key.pem','-out',d+'/cert.pem','-days','1','-subj','/CN=localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args): pass
  def do_GET(self):
   if self.path.split('?')[0]=='/field':body='<label>Card<input id=card autocomplete=cc-number></label><input aria-label=Other>'
   else:body='<input aria-label=Parent><iframe src="https://127.0.0.1:'+str(server.server_port)+'/field"></iframe>' + '<iframe src="/empty"></iframe>'*8 if self.path=='/' else '<label>Auxiliary<input></label>'
   if observation and self.path=='/':body+='<label>Required<input required oninvalid="window.invalidEvents=(window.invalidEvents||0)+1"></label>'
   if controls and self.path=='/':body+='<label>Delivery<select disabled><option value=standard>Standard</option><option value=express>Express</option></select></label>'
   self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body.encode())
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
 tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(d+'/cert.pem',d+'/key.pem');server.socket=tls.wrap_socket(server.socket,server_side=True,do_handshake_on_connect=False)
 threading.Thread(target=server.serve_forever,daemon=True).start()
 url='http://localhost:8769/' if comparison else 'https://localhost:'+str(server.server_port)+'/'
 ns.update(ROOT=d,TARGET_DIR=d,SECRET_KEY_DIR=d+'/keys',CURRENT_TARGET_KEY='local',BROWSER_STATE={'generation':'local','live':{}},DIAGNOSTICS_ENABLED=False)
 def op(name,payload={}):
  out=io.StringIO();start=time.monotonic();before=dict(command_counts)
  with contextlib.redirect_stdout(out):ns['execute_request']({'operation':name,'payload':payload},{'id':target,'webSocketDebuggerUrl':endpoint+'#'+target})
  value=json.loads(out.getvalue())['value'];print(name,round(time.monotonic()-start,3),'CDP commands',sum(command_counts.values())-sum(before.values()),'full AX scans',command_counts.get('Accessibility.getFullAXTree',0)-before.get('Accessibility.getFullAXTree',0));return value
 page.command('Page.enable')
 page.command('Page.navigate',{'url':url})
 time.sleep(1)
 snap=op('snapshot')
 if approval_layout:
  ns['evaluate'](page, """(() => {document.body.innerHTML='<style>main{max-width:760px;margin:auto;padding:16px}section{display:flex;gap:24px;flex-wrap:wrap}input{max-width:100%}</style><main><h2>Checkout</h2><section><div><p>One bag of candy</p><p>Quantity 1</p><p id="total">Total CAD 15.65</p></div><div><label>Deliver to<input value="Example delivery address"></label><p>Mastercard ending 1234</p></div></section><button aria-expanded="false" id="review">Order review</button><button id="buy">Place order</button></main>';})()""")
  captures=[{'label':'baseline', 'page':op('snapshot')}]
  for width,height in [(1440,900),(1024,768),(768,1024),(393,852),(1920,1080)]:
   page.command('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
   for zoom in [0.5,1,1.5,2]:
    ns['evaluate'](page, 'document.documentElement.style.zoom='+json.dumps(str(zoom)))
    captures.append({'label':str(width)+'x'+str(height)+' CSS zoom '+str(zoom),'page':op('snapshot')})
  ns['evaluate'](page, 'document.documentElement.style.zoom="1"')
  for scale in [1,1.5,2]:
   page.command('Emulation.setPageScaleFactor',{'pageScaleFactor':scale})
   captures.append({'label':'visual viewport scale '+str(scale),'page':op('snapshot')})
  ns['evaluate'](page, 'document.querySelector("#review").setAttribute("aria-expanded","true")')
  captures.append({'label':'expansion flag only','page':op('snapshot')})
  ns['evaluate'](page, 'document.querySelector("#total").textContent="Total CAD 25.65"')
  captures.append({'label':'content changes do not revoke explicit approval','page':op('snapshot')})
  with open(approval_output,'w') as handle:json.dump(captures,handle)
  server.shutdown()
  raise SystemExit(0)
 if checkout:
  ns['evaluate'](page, """(() => {document.body.innerHTML='<p id="total">Order total CA$16.78</p><button id="buy">Place order</button>'; window.purchases=0; document.querySelector('button').onclick=()=>{window.purchases++; document.querySelector('#total').textContent='Order confirmed';};})()""")
  snap=op('snapshot'); buy=next(e['ref'] for e in snap['elements'] if e['name']=='Place order')
  # Dispatch uses current geometry at both observed viewport sizes, with no
  # expected-target veto. Temporary overlays clear before a single dispatch.
  for width,height in [(800,600),(1440,900)]:
   page.command('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
   op('click',{'ref':buy,'observeOutcome':True,'expectedUrl':'https://stale.example','expectedTarget':{'name':'Old label'}})
  assert ns['evaluate'](page,'window.purchases')==2
  ns['evaluate'](page, "(() => {const c=document.createElement('div');c.id='cover';c.setAttribute('aria-label','Delivery popup');c.style.cssText='position:fixed;inset:0;z-index:99999';document.body.append(c)})()")
  op('preflight_ref',{'ref':buy})
  try: op('click',{'ref':buy,'observeOutcome':True})
  except ns['PreDispatchError'] as error:
   assert error.input_dispatched is False
   assert '"reason":"covered"' in str(error) and 'Delivery popup' in str(error)
   assert 'Fresh controls' in str(error)
  else: raise AssertionError('Permanent overlay swallowed a click')
  assert ns['evaluate'](page,'window.purchases')==2
  ns['evaluate'](page,"(() => {document.querySelector('#cover').remove();document.querySelector('#total').textContent='Total 25.00'})()")
  op('press',{'ref':buy,'key':'Enter','observeOutcome':True})
  assert ns['evaluate'](page,'window.purchases')==3
  ns['evaluate'](page, "(() => {const c=document.createElement('div');c.style.cssText='position:fixed;inset:0;z-index:99999';document.body.append(c);setTimeout(()=>c.remove(),600)})()")
  op('click',{'ref':buy,'observeOutcome':True})
  assert ns['evaluate'](page,'window.purchases')==4
  ns['evaluate'](page, "(() => {const b=document.querySelector('#buy');b.style.cssText='position:relative;left:0;transition:left .6s linear';requestAnimationFrame(()=>b.style.left='180px')})()")
  op('click',{'ref':buy,'observeOutcome':True})
  assert ns['evaluate'](page,'window.purchases')==5
  # Re-render hides the original target and presents a fresh replacement.
  ns['evaluate'](page, "(() => {const old=document.querySelector('#buy');old.style.display='none';const replacement=document.createElement('button');replacement.id='replacement';replacement.textContent='Place order';replacement.onclick=()=>window.purchases++;document.body.append(replacement)})()")
  try: op('click',{'ref':buy})
  except ns['PreDispatchError'] as error:
   assert '"reason":"hidden"' in str(error), str(error)
   assert 'Fresh controls' in str(error)
  else: raise AssertionError('Hidden original target accepted')
  assert ns['evaluate'](page,'window.purchases')==5
  refreshed=op('snapshot')
  replacement=next(e['ref'] for e in refreshed['elements'] if e['name']=='Place order')
  assert replacement!=buy
  op('click',{'ref':replacement})
  assert ns['evaluate'](page,'window.purchases')==6
  ns['evaluate'](page,"document.querySelector('#replacement').disabled=true")
  try: op('click',{'ref':replacement})
  except ns['PreDispatchError'] as error: assert '"reason":"disabled"' in str(error), str(error)
  else: raise AssertionError('Disabled target accepted')
  assert ns['evaluate'](page,'window.purchases')==6
  print('PASS: blocker identity, hidden target refresh and replacement recovery, disabled reason; no unintended dispatch')
  print('PASS: click at both viewports, no approval comparisons, persistent cover rejected, transient cover and motion waited out, each dispatch once')
  server.shutdown()
  raise SystemExit(0)
 if controls:
  query=ns['extended_query']
  match=query(page,{'role':'combobox','name':'Delivery'})
  assert len(match)==1 and match[0]['name']=='Delivery' and not match[0]['enabled']
  assert query(page,{'role':'combobox','name':'Not Delivery'})==[]
  ns['evaluate'](page,"document.body.insertAdjacentHTML('beforeend', '<section aria-label=Duplicates><label>Choice<select><option>One</option><option>Two</option></select></label><label>Choice<select><option>Three</option></select></label></section>')")
  duplicates=query(page,{'role':'combobox','name':'Choice'})
  assert len(duplicates)==2 and len({e['ref'] for e in duplicates})==2
  assert len(query(page,{'role':'combobox','name':'Cho','exact':False}))==2
  assert query(page,{'role':'combobox','name':'Cho'})==[]
  assert len(query(page,{'role':'combobox','name':'Choice','scopes':[{'css':'section[aria-label=Duplicates]'}]}))==2
  assert len(query(page,{'role':'textbox','name':'Card'}))==1
  # Ref reads remain fresh and retain actual-node identity, including child
  # frames. They must not synchronize counters or assign refs to clones.
  original=duplicates[0]['ref']
  counters_before=command_counts.get('frame_values',0)
  batches_before=command_counts.get('reference_query',0)
  assert query(page,{'ref':original})[0]['ref']==original
  assert command_counts.get('reference_query',0)==batches_before+1
  assert command_counts.get('frame_values',0)==counters_before
  ns['evaluate'](page,"document.querySelector('section[aria-label=Duplicates] select').setAttribute('title','Updated')")
  assert query(page,{'ref':original})[0]['attributes']['title']=='Updated'
  ns['evaluate'](page,"(() => { const e=document.querySelector('section[aria-label=Duplicates] select'); e.after(e.cloneNode(true)); })()")
  assert len(query(page,{'ref':original}))==1, 'Cloned ref attribute accepted'
  ns['evaluate'](page,"document.querySelector('section[aria-label=Duplicates] select').remove()")
  assert query(page,{'ref':original})==[], 'Detached ref rebound to clone'
  child=query(page,{'role':'textbox','name':'Card'})[0]
  assert len(query(page,{'ref':child['ref']}))==1
  print('PASS: ref reads skip counter synchronization; fresh attributes, OOPIF, clones and detached nodes preserved')
  print('PASS: native-name fallback, ambiguity, scopes, exact/substring names and OOPIF lookup')
  select=next(e['ref'] for e in snap['elements'] if e['name']=='Delivery')
  try:op('select',{'ref':select,'value':'express'})
  except RuntimeError:pass
  else:raise AssertionError('Disabled select accepted a mutation')
  ns['evaluate'](page,"document.querySelector('select').disabled=false")
  selected=op('select',{'ref':select,'value':'express'})
  assert next(e for e in selected['elements'] if e['ref']==select)['value']=='express'
  combined=op('preflight_locator',{'locator':{'role':'combobox','name':'Delivery','exact':True},'fullPage':False})
  assert combined['matches'][0]['ref']==select and combined['element']['name']=='Delivery'
  assert combined['page']['scopeRef']==select and combined['element']['disabled'] is False
  ns['evaluate'](page,"document.querySelector('select').disabled=true")
  fresh=op('preflight_locator',{'locator':{'ref':select},'fullPage':False})
  assert fresh['element']['disabled'] is True
  missing=op('preflight_locator',{'locator':{'role':'button','name':'Not present'},'fullPage':False})
  assert missing=={'matches':[]}
  try:op('preflight_locator',{'locator':{'role':'textbox','name':'Auxiliary'},'fullPage':False})
  except RuntimeError as e:assert 'Locator matched' in str(e)
  else:raise AssertionError('Ambiguous locator accepted')
  child=op('preflight_locator',{'locator':{'role':'textbox','name':'Card'},'fullPage':False})
  assert child['element']['name']=='Card' and not child['element']['mainFrame']
  print('PASS: combined preflight preserves missing/ambiguous/native/OOPIF checks')
  server.shutdown()
  print('PASS: disabled selection rejected; enabled selection retained')
  raise SystemExit(0)
 if observation:
  if 'dom_ref_map' in ns:
   sessions={context.get('sessionId') for context in ns['frame_contexts'](page)}
   for session in sessions:
    original=page.command('DOMSnapshot.captureSnapshot',{'computedStyles':[]},session_id=session)
    refs={}
    for document in original['documents']:
     for backend,attrs in zip(document['nodes']['backendNodeId'],document['nodes']['attributes']):
      for i in range(0,len(attrs),2):
       if original['strings'][attrs[i]]=='data-decision-feed-ref':refs[backend]=original['strings'][attrs[i+1]]
    current=ns['dom_ref_map'](page.command('DOM.getDocument',{'depth':-1,'pierce':True},session_id=session))
    assert refs==current, 'Native DOM read changed backend/ref joins across frames'
   print('PASS: native backend/ref maps match prior DOMSnapshot for every frame process')
  events=ns['evaluate'](page,'window.invalidEvents || 0')
  print('Observation invalid events:',events)
  assert events==0, 'Snapshot triggered website invalid handlers'
  invalid=next(e for e in snap['elements'] if e['name']=='Required')
  assert invalid['valid'] is False
  assert ns['secure_field_state'](page,invalid['ref'])['nativeValid'] is False
  assert ns['evaluate'](page,'window.invalidEvents || 0')==0
  before=command_counts.get('DOM.getDocument',0)
  repeated=op('snapshot')
  assert command_counts.get('DOM.getDocument',0)==before, 'Unchanged refs fetched the complete DOM again'
  ns['evaluate'](page,"document.querySelector('[aria-label=Parent]').setAttribute('aria-label','Renamed')")
  renamed=op('snapshot')
  assert any(e['name']=='Renamed' for e in renamed['elements'])
  assert command_counts.get('DOM.getDocument',0)==before, 'AX name change invalidated stable node identities'
  old=next(e['ref'] for e in renamed['elements'] if e['name']=='Renamed')
  runtime_before=command_counts.get('Runtime.evaluate',0)
  releases_before=command_counts.get('Runtime.releaseObject',0)
  described=ns['describe'](page,old)
  assert described['name']=='Renamed'
  assert command_counts.get('Runtime.evaluate',0)-runtime_before==1, 'Known node identity was redundantly resolved'
  assert command_counts.get('Runtime.releaseObject',0)==releases_before
  assert not any(key.startswith('_identity') for key in described)
  ns['evaluate'](page,"document.querySelector('[aria-label=Renamed]').setAttribute('aria-disabled','true')")
  assert ns['describe'](page,old)['disabled'] is True
  ns['evaluate'](page,"document.querySelector('[aria-label=Renamed]').removeAttribute('aria-disabled')")
  assert ns['describe'](page,old)['disabled'] is False
  assert all('_refToken' not in element for element in renamed['elements'])
  card_ref=next(element['ref'] for element in renamed['elements'] if element['name']=='Card')
  backend_before=command_counts.get('backendIdentityReads',0)
  assert ns['describe'](page,card_ref)['name']=='Card'
  assert command_counts.get('backendIdentityReads',0)==backend_before+1, 'Child-frame identity cache did not retain session scope'
  print('PASS: verified backend identity avoids re-resolution; native names and disabled state stay fresh')
  ns['evaluate'](page,"const e=document.querySelector('[aria-label=Renamed]');e.replaceWith(e.cloneNode(true))".replace('const e=', '(() => {const e=')+';})()')
  runtime_before=command_counts.get('Runtime.evaluate',0)
  assert ns['describe'](page,old)['name']=='Renamed'
  assert command_counts.get('Runtime.evaluate',0)-runtime_before>=2, 'A cloned attribute reused the previous node identity'
  replaced=op('snapshot')
  new=next(e['ref'] for e in replaced['elements'] if e['name']=='Renamed')
  assert new!=old and command_counts.get('DOM.getDocument',0)>before
  ns['evaluate'](page,"document.querySelector('[aria-label=Renamed]').setAttribute('data-decision-feed-secret','true')")
  secret=op('snapshot')
  assert next(e for e in secret['elements'] if e['ref']==new)['valueRedacted']
  ns['set_secret_mask'](page,True)
  assert all(ns['evaluate_context'](page,"Boolean(deepQuery('#decision-feed-secret-mask'))",context) for context in ns['frame_contexts'](page))
  assert ns['evaluate'](page,"getComputedStyle(document.querySelector('[aria-label=Renamed]')).color")=='rgba(0, 0, 0, 0)'
  ns['set_secret_mask'](page,False)
  assert not any(ns['evaluate_context'](page,"Boolean(deepQuery('#decision-feed-secret-mask'))",context) for context in ns['frame_contexts'](page))
  assert ns['evaluate'](page,"getComputedStyle(document.querySelector('[aria-label=Renamed]')).color")!='rgba(0, 0, 0, 0)'
  print('PASS: screenshot masks cover every frame, hide marked content and are removed afterward')
  before=command_counts.get('DOM.getDocument',0)
  ns['evaluate'](page,"document.querySelector('iframe').src+='?new-document'")
  time.sleep(.3)
  navigated=op('snapshot')
  assert command_counts.get('DOM.getDocument',0)>before
  assert any(e['name']=='Card' for e in navigated['elements'])
  server.shutdown()
  print('PASS: native AX stays fresh; stable identities reuse DOM map; cloned nodes and frame navigation invalidate; secret marks remain fresh')
  print('PASS: observation preserves invalid state without firing events')
  raise SystemExit(0)
 if comparison:
  print('SNAPSHOT',len(json.dumps(snap)),'bytes',len(snap['elements']),'controls')
  search=next(e['ref'] for e in snap['elements'] if e['name']=='Search products')
  typed=op('type',{'ref':search,'text':'ordinary search text'})
  assert 'Match: ordinary search text' in typed['text']
  button=next(e['ref'] for e in typed['elements'] if e['name']=='Continue')
  try:
   clicked=op('click',{'ref':button})
   print('CLICK RESULT', 'Continued' in clicked['text'])
  except RuntimeError as error:
   print('CLICK ERROR',str(error))
  server.shutdown()
  raise SystemExit(0)
 auxiliary=[e for e in snap['elements'] if e['name']=='Auxiliary']
 assert len(auxiliary)==8 and len({e['ref'] for e in auxiliary})==8
 assert all(any(row.get('ref')==e['ref'] for row in snap['axTree']) for e in auxiliary), 'Child refs missing from AX after shared DOM read'
 if typing:
  parent=next(e['ref'] for e in snap['elements'] if e['name']=='Parent')
  ns['evaluate'](page,"(() => {globalThis.keyups=0;document.querySelector('input').addEventListener('keyup',()=>globalThis.keyups++);return true})()")
  typed=op('type',{'ref':parent,'text':'ordinary search text'})
  assert next(e for e in typed['elements'] if e['ref']==parent).get('value')=='ordinary search text'
  assert ns['evaluate'](page,'globalThis.keyups')>=20
  # Compare native insertion without changing the production typing strategy.
  original=ns['replace_field_text']
  ns['replace_field_text']=lambda cdp,ref,text,require_focused=False:original(cdp,ref,text,strategy='insert',require_focused=require_focused)
  keyups=ns['evaluate'](page,'globalThis.keyups')
  inserted=op('type',{'ref':parent,'text':'replacement search text'})
  assert next(e for e in inserted['elements'] if e['ref']==parent).get('value')=='replacement search text'
  assert ns['evaluate'](page,'globalThis.keyups')==keyups
  print('PASS: both retain text; native insertion omits keyboard events, so it is not behavior-equivalent')
  server.shutdown()
  raise SystemExit(0)
 ref=next(e['ref'] for e in snap['elements'] if e['name']=='Card')
 op('preflight_ref',{'ref':ref,'fullPage':False})
 op('click',{'ref':ref})
 op('secure_target',{'ref':ref})
 op('snapshot');op('secure_target',{'ref':ref})
 op('screenshot',{'path':d+'/screenshot-test.png'});op('secure_target',{'ref':ref})
 # Simulate normal loss of focus during the phone unlock.
 e=ns['describe'](page,ref);ns['evaluate'](page,'document.activeElement.blur()',e['contextId'],e.get('sessionId'))
 if baseline:
  try:op('secure_target',{'ref':ref})
  except RuntimeError as error:
   assert 'focus changed' in str(error)
   print('BASELINE: reproduced lost-focus failure')
   server.shutdown()
   raise SystemExit(0)
  raise AssertionError('Expected baseline to reproduce lost focus')
 op('secure_target',{'ref':ref})
 assert e.get('sessionId'), 'Fixture must exercise a real cross-origin OOPIF'
 # Exercise the production fill with synthetic data; only decryption is stubbed.
 ns['decrypt_device_envelope']=lambda *args:{'kind':'payment_card','cardNumber':'4111111111111111'}
 filled=op('secure_fill_envelope',{'token':'a'*32,'kind':'payment_card','envelope':{},'expectedUrl':url,'fields':[{'name':'cardNumber','ref':ref}]})
 assert filled['secureFieldsVerified']
 assert '4111111111111111' not in json.dumps(filled), 'Secret leaked into snapshot'
 assert ns['secure_field_state'](page,ref)['value']=='4111111111111111'
 other=next(e for e in filled['elements'] if e['name']=='Other')
 assert other.get('value','')==''
 # A covering element must stop entry instead of redirecting secret text.
 ns['evaluate'](page,"document.body.insertAdjacentHTML('beforeend','<div style=\"position:fixed;inset:0;background:white;z-index:9999\"></div>')",e['contextId'],e.get('sessionId'))
 try:op('secure_target',{'ref':ref})
 except RuntimeError as error:assert 'covered' in str(error),str(error)
 else:raise AssertionError('Covered secure field accepted')
 ns['evaluate'](page,"document.querySelector('div').remove()",e['contextId'],e.get('sessionId'))
 ns['evaluate'](page,"document.body.insertAdjacentHTML('beforeend','<div style=\"position:fixed;inset:0;background:white;z-index:9999\"></div>')")
 try:op('secure_target',{'ref':ref})
 except RuntimeError:pass
 else:raise AssertionError('Parent overlay bypassed')
 ns['evaluate'](page,"document.querySelector('div').remove()")
 for attribute in ['disabled','readonly','hidden']:
  ns['evaluate'](page,'document.getElementById(\"card\").setAttribute('+json.dumps(attribute)+',\"\")',e['contextId'],e.get('sessionId'))
  try:op('secure_target',{'ref':ref})
  except RuntimeError:pass
  else:raise AssertionError(attribute+' secure field accepted')
  ns['evaluate'](page,'document.getElementById(\"card\").removeAttribute('+json.dumps(attribute)+')',e['contextId'],e.get('sessionId'))
 # Reload preserves the run/tab recipient, then use freshly inspected refs.
 ns['decrypt_device_envelope']=lambda *args:{'kind':'payment_card','securityCode':'123'}
 token='b'*32
 keypath=ns['secret_key_path'](token)
 with open(keypath,'w') as handle:handle.write('fixture recipient')
 scope=ns['secret_scope']()
 payload={'token':token,'kind':'payment_card','envelope':{},'expectedUrl':url,'fields':[{'name':'securityCode','ref':ref}],'retainForSecureTyping':True}
 assert op('secure_fill_envelope',payload)['secureFieldsVerified']
 page.command('Page.reload');time.sleep(.6)
 ns['ready'](page)
 fresh=op('snapshot')
 newref=next(item['ref'] for item in fresh['elements'] if item['name']=='Card')
 assert ns['secret_scope']()==scope and os.path.exists(keypath)
 payload['fields']=[{'name':'securityCode','ref':newref}]
 assert op('secure_fill_envelope',payload)['secureFieldsVerified']
 assert ns['secure_field_state'](page,newref)['value']=='123'
 assert os.path.exists(keypath)
 print('PASS: CVC release reused after actual checkout reload with fresh field ref')
 server.shutdown()
 print('PASS: cross-origin fill survives lost focus; other field untouched; covered target rejected')
for c in connections.values():c.sock.close()
