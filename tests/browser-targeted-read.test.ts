import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const frameHelpers=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def frame_observation_expression('),CLOUD_BROWSER_CONTROLLER.indexOf('def set_secret_mask('));
import { EXTENDED_BROWSER_CONTROLLER } from '../lib/harness/browser/extended-controller';

test('existing-ref reads scan all frames freshly without allocating or synchronizing refs',()=>{
 const source=EXTENDED_BROWSER_CONTROLLER.slice(EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_query('),EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_secure_page('));
 const result=spawnSync('python3',['-c',`import json\n${source}\n`+String.raw`
DOM_HELPERS=''
reads=[]
def recover_observation(cdp,read):return read()
def frame_contexts(cdp,refresh=False):
 assert refresh
 return [{'frameId':'main','main':True},{'frameId':'child','main':False}]
def frame_reference_counter(*args):raise AssertionError('Ref read allocated identities')
def evaluate_context(cdp,expression,context):
 assert 'const q=' in expression, 'Unexpected counter commit'
 assert 'globalThis.__wdytRefCounter=' not in expression
 reads.append(context['frameId'])
 return {'matches':[{'ref':'e51','text':str(len(reads))}],'nextRef':500}
assert len(extended_query(None,{'ref':'e51'}))==2, 'Ambiguity hidden'
assert reads==['main','child']
assert extended_query(None,{'ref':'e51','frame':'child'})[0]['text']=='3'
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('batched ref queries preserve ambiguity, frame selection, indexing and read failures',()=>{
 const source=EXTENDED_BROWSER_CONTROLLER.slice(EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_query('),EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_secure_page('));
 const result=spawnSync('python3',['-c',`import json\n${source}\n`+String.raw`
DOM_HELPERS=''
def recover_observation(cdp,read):return read()
def frame_contexts(cdp,refresh=False):return [{'frameId':'main','main':True},{'frameId':'child','main':False}]
def frame_reference_counter(*args):raise AssertionError('Counter sync on ref read')
class CDP:
 def __init__(self):self.calls=[];self.fail=False
 def reference_query(self,contexts,ref):
  self.calls.append([c['frameId'] for c in contexts])
  return [{'error':'Cannot find context'} if self.fail and c['frameId']=='child' else {'value':{'matches':[{'ref':ref,'text':c['frameId']}],'nextRef':10}} for c in contexts]
c=CDP()
assert extended_query(c,{'ref':'e1'})==[{'ref':'e1','text':'main','frameId':'main','mainFrame':True},{'ref':'e1','text':'child','frameId':'child','mainFrame':False}]
assert extended_query(c,{'ref':'e1','index':-1})==[{'ref':'e1','text':'child','frameId':'child','mainFrame':False}]
assert extended_query(c,{'ref':'e1','index':0})==[{'ref':'e1','text':'main','frameId':'main','mainFrame':True}]
assert extended_query(c,{'ref':'e1','frame':'child'})==[{'ref':'e1','text':'child','frameId':'child','mainFrame':False}]
assert c.calls[-1]==['child']
assert extended_query(c,{'ref':'e1','frame':'missing'})==[]
c.fail=True
try:extended_query(c,{'ref':'e1'})
except RuntimeError as e:assert str(e)=='Cannot find context'
else:raise AssertionError('Incomplete frame result accepted as unique')
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('locator queries refresh frames without taking a full snapshot, including a stale-context retry', () => {
 const source = EXTENDED_BROWSER_CONTROLLER.slice(EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_query('), EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_secure_page('));
 const result = spawnSync('python3', ['-c', `import json\n${frameHelpers}\n${source}\n` + String.raw`
DOM_HELPERS=''
contexts=[{'frameId':'main','main':True},{'frameId':'child','main':False}]
reads=[]
stale=True
def snapshot(cdp):raise AssertionError('A locator lookup must not serialize the full page')
def frame_contexts(cdp,refresh=False):
 assert refresh
 return contexts
def evaluate_context(cdp,expression,context):
 global stale
 if 'const q=' in expression:
  if stale:
   stale=False
   raise RuntimeError('Cannot find context')
  reads.append(context['frameId'])
  return {'matches':[{'ref':'e51','name':'Save'}],'nextRef':51}
 return 50
def recover_observation(cdp,read):
 try:return read()
 except RuntimeError:return read()
assert extended_query(None,{'role':'button','frame':'child'})==[{'ref':'e51','name':'Save','frameId':'child','mainFrame':False}]
assert reads==['child']
`], {encoding:'utf8'});
 assert.equal(result.status, 0, result.stderr);
});

test('a missing DOM name falls back to native accessible names without guessing among matches',()=>{
 const source=EXTENDED_BROWSER_CONTROLLER.slice(EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_query('),EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_secure_page('));
 const result=spawnSync('python3',['-c',`import json\n${frameHelpers}\n${source}\n`+String.raw`
DOM_HELPERS=''
reads=[]
def frame_contexts(cdp,refresh=False):return [{'frameId':'main'}]
def evaluate_context(cdp,expression,context):
 if 'const q=' not in expression:return 50
 reads.append(expression)
 return {'matches':[{'ref':'e51','name':'Choice One Two'},{'ref':'e52','name':'Choice One Two'}],'nativeCandidates':True,'nextRef':52}
def accessibility_identity(cdp,context):return [],{'e51':{'role':'combobox','name':'Choice'},'e52':{'role':'combobox','name':'Choice'}}
def recover_observation(cdp,read):return read()
rows=extended_query(None,{'role':'combobox','name':'Choice'})
assert len(rows)==2 and all(r['name']=='Choice' for r in rows)
assert len(reads)==1
assert extended_query(None,{'role':'combobox','name':'Other'})==[]
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
