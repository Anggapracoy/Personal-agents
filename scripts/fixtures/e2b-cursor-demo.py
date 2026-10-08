import zipfile,base64,contextlib,io,json,os,socket,subprocess,tempfile,threading,time,urllib.parse,urllib.request
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
ns={'__name__':'e2b_cursor_demo'}
exec(open('/workspace/cursor-controller.py').read(),ns)
Base=ns['DirectCDP']
class LocalCDP(Base):
 def __init__(self,endpoint):
  self.endpoint=endpoint;u=urllib.parse.urlparse(endpoint);self.sock=socket.create_connection((u.hostname,u.port));self.next_id=1;self.events=[];self.attached_targets={};self.page_session=None
  key=base64.b64encode(os.urandom(16)).decode()
  self.sock.sendall(('GET '+u.path+' HTTP/1.1\r\nHost: '+u.netloc+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
  header=b''
  while b'\r\n\r\n' not in header:header+=self.sock.recv(1)
  assert header.startswith(b'HTTP/1.1 101'),header
  if u.fragment:self.page_session=self.command('Target.attachToTarget',{'targetId':u.fragment,'flatten':True})['sessionId']
connections={}
def connect(endpoint):
 if endpoint not in connections:connections[endpoint]=LocalCDP(endpoint)
 return connections[endpoint]
LocalCDP.close=lambda self:None
ns['CDP']=connect
# Local Chromium has no Browserless pool. Input and decoration still have
# separate real CDP sockets and the exact production controller expressions.
visual_connections={}
def visual(cdp):
 endpoint=cdp.endpoint if hasattr(cdp,'endpoint') else page_endpoint
 if endpoint not in visual_connections:visual_connections[endpoint]=LocalCDP(endpoint)
 return visual_connections[endpoint]
ns['cursor_transport']=visual
html='''<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:#161414;color:#f4f4f4;font:20px system-ui}main{padding:55px 80px}h1{font-size:34px;margin:0 0 12px}p{color:#bbb}button,input{font:20px system-ui;border-radius:14px;padding:18px;border:1px solid #555;background:#292727;color:white}button{cursor:pointer}section{display:flex;justify-content:space-between;margin-top:110px;gap:60px}label{display:grid;gap:15px}#next{margin-top:80px;width:220px}#status{margin-top:40px;color:#86bc97}iframe{width:280px;height:100px;border:0;margin-top:50px}</style><main><h1>Signature Arc · real E2B browser</h1><p>Dash's existing controller · avatar-coloured glow · synthetic test controls</p><section><button id="one" onclick="document.getElementById('status').textContent='First click received exactly once';window.clicks=(window.clicks||0)+1">Choose option</button><button id="two" onclick="document.getElementById('status').textContent='Second click received exactly once';window.clicks2=(window.clicks2||0)+1">Confirm selection</button></section><section><label>Test name<input aria-label="Test name"></label><button id="next" onclick="location.href='/next'">Next page</button></section><div id="status">Ready</div><iframe src="/frame"></iframe></main>'''
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  body='<style>body{background:#161414;color:white;font:18px system-ui}button{padding:15px;background:#292727;color:white;border:1px solid #555;border-radius:12px}</style><button onclick="this.textContent=\'Frame clicked\'">Frame button</button>' if self.path=='/frame' else '<style>body{background:#161414;color:white;font:25px system-ui;padding:70px}button{margin-top:150px;font:24px system-ui;padding:20px;border-radius:14px}</style><h1>Navigation worked</h1><p>Cursor position and avatar colour restored.</p><button onclick="this.textContent=\'Finished\'">Finish</button>' if self.path=='/next' else html
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(body.encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory() as d:
 chrome=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-port=9222','--remote-allow-origins=*','--window-size=1280,900','--user-data-dir='+d,'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(100):
   try:version=json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/version'));break
   except Exception:time.sleep(.1)
  endpoint=version['webSocketDebuggerUrl'];root=connect(endpoint);target=root.command('Target.createTarget',{'url':'about:blank'})['targetId'];page_endpoint=endpoint+'#'+target;page=connect(page_endpoint)
  ns.update(ROOT=d,TARGET_DIR=d,BROWSER_STATE_PATH=d+'/state.json',SECRET_KEY_DIR=d+'/keys',CURRENT_TARGET_KEY='cursor',BROWSER_STATE={'generation':'e2b','live':{}},DIAGNOSTICS_ENABLED=False)
  ns['checkpoint_profile']=lambda *args:None
  os.environ['DASH_CURSOR_COLOR']='#4C7FE6'
  def op(name,payload={}):
   out=io.StringIO()
   with contextlib.redirect_stdout(out):ns['execute_request']({'operation':name,'payload':payload},{'id':target,'webSocketDebuggerUrl':page_endpoint})
   return json.loads(out.getvalue())['value']
  page.command('Page.enable');page.command('Page.bringToFront');page.command('Emulation.setDeviceMetricsOverride',{'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False});page.command('Page.navigate',{'url':'http://127.0.0.1:'+str(server.server_port)+'/'});time.sleep(.6)
  # Record the real E2B viewport stream. Encode on the host afterwards so
  # video encoding cannot steal CPU from the browser being measured.
  capture=d+'/frames';os.makedirs(capture)
  stop=threading.Event();frames=[];errors=[]
  def record():
   c=LocalCDP(page_endpoint)
   try:
    c.command('Page.enable');c.command('Page.startScreencast',{'format':'jpeg','quality':92,'maxWidth':1280,'maxHeight':900,'everyNthFrame':1})
    while not stop.is_set():
     c.sock.settimeout(.3)
     try:m=c.receive()
     except socket.timeout:continue
     if m.get('method')!='Page.screencastFrame':continue
     p=m['params'];stamp=time.monotonic();name='%05d.jpg'%len(frames)
     with open(capture+'/'+name,'wb') as image:image.write(base64.b64decode(p['data']))
     frames.append((stamp,name))
     msg={'id':c.next_id,'method':'Page.screencastFrameAck','params':{'sessionId':p['sessionId']}};c.next_id+=1
     if c.page_session:msg['sessionId']=c.page_session
     c.send(msg)
   except Exception as e:errors.append(str(e))
   finally:c.sock.close()
  thread=threading.Thread(target=record,daemon=True);thread.start()
  def ref(name):return next(e['ref'] for e in op('snapshot')['elements'] if e['name']==name)
  time.sleep(.7);op('hover',{'ref':ref('Choose option')});time.sleep(.8)
  assert ns['evaluate'](page,"Boolean(document.getElementById('dash-visual-cursor'))"),'Production cursor did not render'
  op('click',{'ref':ref('Choose option')});time.sleep(1)
  op('click',{'ref':ref('Confirm selection')});time.sleep(1.3)
  assert ns['evaluate'](page,'[window.clicks,window.clicks2]')==[1,1],'Input duplicated'
  frame_ref=ref('Frame button');op('click',{'ref':frame_ref});time.sleep(1.2);assert 'Frame clicked' in op('snapshot')['text'],'Frame input failed'
  name=ref('Test name');op('click',{'ref':name});time.sleep(1);op('type',{'ref':name,'text':'E2B verified'});time.sleep(.8)
  assert ns['evaluate'](page,'document.querySelector("input").value')=='E2B verified','Typing failed'
  op('hover',{'ref':ref('Next page')});time.sleep(1.1);op('click',{'ref':ref('Next page')});time.sleep(1.5)
  assert 'Navigation worked' in op('snapshot')['text'],'Navigation failed'
  op('click',{'ref':ref('Finish')});time.sleep(1.5);assert 'Finished' in op('snapshot')['text'],'Final click failed'
  stop.set();thread.join(3);assert not errors,errors
  assert len(frames)>100,('Too few actual frames',len(frames))
  with open(capture+'/frames.txt','w') as manifest:
   for i,(stamp,name) in enumerate(frames):
    manifest.write("file '"+name+"'\n")
    if i+1<len(frames):manifest.write('duration '+str(max(.001,frames[i+1][0]-stamp))+'\n')
   manifest.write("file '"+frames[-1][1]+"'\n")
  with zipfile.ZipFile('/workspace/out/cursor-frames.zip','w') as archive:
   for name in os.listdir(capture):archive.write(capture+'/'+name,name)
  print(json.dumps({'environment':'Chromium inside E2B','frames':len(frames),'seconds':round(frames[-1][0]-frames[0][0],2),'checks':['two clicks exactly once','embedded-frame click','typing','navigation','final click'],'recording':'/workspace/out/cursor-frames.zip'}))
 finally:chrome.terminate();server.shutdown()
