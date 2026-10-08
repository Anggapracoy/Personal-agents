import io,json,contextlib,base64
ns={'__name__':'browserless_fixture','__file__':controller_path}
exec(controller,ns)
ns['CURRENT_TARGET_KEY']=target_key
ns['connect_browser']({'operation':'snapshot'})
ns['DIAGNOSTICS_ENABLED']=False
target=ns['choose_target'](target_key,False)
cdp=ns['CDP'](target['webSocketDebuggerUrl'])
def op(operation,payload={}):
 global target
 target=ns['choose_target'](target_key,False)
 out=io.StringIO()
 with contextlib.redirect_stdout(out):ns['execute_request']({'operation':operation,'payload':payload},target)
 return json.loads(out.getvalue())['value']
def ext(action,**kw):return op('extended',{'action':action,**kw})
def query(q):return ext('query',locator=q)['matches']
try:
 frame=cdp.command('Page.getFrameTree')['frameTree']['frame']['id']
 cdp.command('Page.setDocumentContent',{'frameId':frame,'html':'<title>Private browser controls fixture</title><label>Search<input id=q></label><input type=file aria-label="Upload"><button id=d onclick="confirm(\'Continue?\')">Dialog</button><button id=b ondblclick="this.textContent=\'Double clicked\'">Double</button>'})
 field=query({'label':'Search'})[0]['ref']
 op('type',{'ref':field,'text':'slate'})
 op('press',{'ref':field,'key':'ControlOrMeta+A'})
 op('press',{'ref':field,'key':'ControlOrMeta+C'})
 assert ext('clipboard_read')['text']=='slate'
 op('press',{'ref':field,'key':'Backspace'})
 op('press',{'ref':field,'key':'ControlOrMeta+V'})
 assert ext('evaluate',expression="document.querySelector('#q').value")['value']=='slate'
 print('PASS Linux Browserless shortcuts, selection and task-local clipboard')
 upload=query({'css':'input[type=file]'})[0]['ref']
 ext('upload',ref=upload,files=[{'name':'hello.txt','base64':base64.b64encode(b'Browserless upload payload').decode(),'mimeType':'text/plain'}])
 assert ext('evaluate',expression="document.querySelector('input[type=file]').files[0].size")['value']==26
 print('PASS real remote browser upload receives file bytes')
 ref=query({'role':'button','name':'Double'})[0]['ref'];op('click',{'ref':ref,'clickCount':2})
 assert query({'role':'button','name':'Double clicked'})
 ref=query({'role':'button','name':'Dialog'})[0]['ref'];value=op('click',{'ref':ref})
 assert 'Continue?' in value['text']
 ext('dialog',accept=False)
 assert op('snapshot')['title']=='Private browser controls fixture'
 print('PASS Browserless double-click and modal dialog recovery')
 # Hidden duplicates must be explicitly filterable, including dialog scopes.
 ns['evaluate'](cdp,"(() => { const d=document.createElement('div');d.innerHTML='<button hidden>Duplicate</button><div role=dialog><button>Duplicate</button></div>';document.body.append(d);return true;})()")
 assert len(query({'role':'button','name':'Duplicate'}))==2
 assert len(query({'role':'button','name':'Duplicate','visible':True}))==1
 assert len(query({'role':'button','name':'Duplicate','scopes':[{'role':'dialog','visible':True}]}))==1
 # Simulate the real frame-navigation race after snapshot, before query.
 original=ns['evaluate_context']; failures=[]
 def transient(page,expression,context):
  if 'const q=' in expression and not failures:
   failures.append(1);raise RuntimeError('Cannot find context with specified id')
  return original(page,expression,context)
 ns['evaluate_context']=transient
 try: assert len(query({'role':'button','name':'Duplicate','visible':True}))==1
 finally: ns['evaluate_context']=original
 assert failures==[1]
 print('PASS visible/dialog targeting and stale context recovery')

 # Exercise the extended API on the real remote transport too.
 cdp.command('Runtime.evaluate',{'expression':"document.body.insertAdjacentHTML('beforeend', '<div data-testid=scope><span>Read me</span></div><button id=r oncontextmenu=\"event.preventDefault();this.textContent=String(42)\">Right</button><iframe srcdoc=\"<button>Frame button</button>\"></iframe>')"})
 assert query({'css':'span','scopes':[{'testId':'scope'}]})[0]['text']=='Read me'
 assert query({'text':'Frame button'})
 ref=query({'role':'button','name':'Right'})[0]['ref'];op('click',{'ref':ref,'button':'right'})
 assert query({'role':'button','name':'42'})
 try:ext('evaluate',expression="document.body.innerHTML='mutated'")
 except RuntimeError:pass
 else:raise AssertionError('Read-only evaluation allowed mutation')
 assert op('snapshot')['title']=='Private browser controls fixture'
 print('PASS scoped locators, iframe, right-click and side-effect rejection')
 first=target['id'];second=ext('tabs_new')['createdId']
 ext('tabs_select',id=second);op('navigate',{'url':'https://example.com/'})
 ext('reload');op('navigate',{'url':'https://example.com/?second=1'});op('back');ext('forward')
 assert '?second=1' in op('snapshot')['url']
 data=ext('download',url='https://example.com/')
 assert b'Example Domain' in base64.b64decode(data['base64'])
 ext('tabs_close',id=second)
 assert op('snapshot')['title']=='Private browser controls fixture'
 try:ext('tabs_select',id='foreign-task-tab')
 except RuntimeError:pass
 else:raise AssertionError('Foreign tab was accepted')
 print('PASS tabs, navigation, downloads and task isolation')
 # A wrapping label includes option text in the DOM, but not in its native
 # accessible name. Locator names must agree with the inspection presented.
 ns['evaluate'](cdp, "(() => {const label=document.createElement('label');label.innerHTML='Dropdown (select)<select><option value=1>One</option><option value=2>Two</option></select>';document.body.append(label);return true;})()")
 matches=query({'role':'combobox','name':'Dropdown (select)'})
 assert len(matches)==1, 'Locator did not recognize the native accessible name'
 assert query({'role':'option','name':'Two'})[0]['attributes']['value']=='2'
 assert 'value' not in query({'css':'input[type=file]'})[0]['attributes']
 op('select',{'ref':matches[0]['ref'],'value':'2'})
 assert ns['evaluate'](cdp,"document.querySelector('select').value")=='2'
 print('PASS native dropdown accessible name matches inspection')
 print('ALL Browserless control checks passed')
finally:ns['finish_browser']()
