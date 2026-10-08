ns.update(ROOT=d,TARGET_DIR=d,SECRET_KEY_DIR=d+'/keys',BROWSER_STATE_PATH=d+'/state.json',CURRENT_TARGET_KEY='keyboard-test',BROWSER_STATE={'generation':'local','live':{}},DIAGNOSTICS_ENABLED=False)
current={'id':target,'webSocketDebuggerUrl':endpoint+'#'+target}
def op(payload):
 out=io.StringIO()
 with contextlib.redirect_stdout(out):ns['execute_request']({'operation':'keyboard_type','payload':payload},current)
 return json.loads(out.getvalue())['value']
def js(expression):return ns['evaluate'](page,expression)
js('''(() => {document.body.innerHTML='<button id="back">Backspace</button><input id="field"><div id="edit" contenteditable="true">edit</div><iframe></iframe>';window.typed='';window.clicks=0;window.trusted=0;document.querySelector('#back').onclick=()=>{clicks++;typed=typed.slice(0,-1)};document.addEventListener('keydown',e=>{if(e.key.length===1){typed+=e.key;if(e.isTrusted)trusted++}});document.querySelector('#back').focus()})()''')
count=[0]
original=ns['snapshot']
def counted(*args):count[0]+=1;return original(*args)
ns['snapshot']=counted
op({'text':'slate'})
assert js('typed')=='slate' and js('clicks')==0 and js('trusted')==5
assert count[0]==1
op({'text':'Enter'})
assert js('typed')=='slateEnter' and js('clicks')==0
for selector in ['#field','#edit','iframe']:
 js('document.querySelector('+json.dumps(selector)+').focus()')
 try:op({'text':'unsafe'})
 except RuntimeError:pass
 else:raise AssertionError('Accepted focused '+selector)
 assert js('document.activeElement===document.querySelector('+json.dumps(selector)+')')
assert js('typed')=='slateEnter'
for text in ['','line\nnext','\t','\x00','x'*513]:
 try:op({'text':text})
 except RuntimeError:pass
 else:raise AssertionError('Accepted invalid text')
js("(() => {document.activeElement.blur();document.querySelector('#field').type='password'})()")
try:op({'text':'unsafe'})
except RuntimeError:pass
else:raise AssertionError('Accepted secure page')
js("(() => {document.querySelector('#field').type='text';document.querySelector('#back').onblur=()=>document.querySelector('#field').focus();document.querySelector('#back').focus()})()")
try:op({'text':'unsafe'})
except RuntimeError:pass
else:raise AssertionError('Accepted blur handler focus redirection')
assert js('typed')=='slateEnter'
print('PASS trusted full-word typing, one snapshot, literal Enter, no button activation, editable/frame/secure/control-character/focus-redirection guards')
