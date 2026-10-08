import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';

test('only explicit ordinary replacement fills can defer observation; secret guards remain active',()=>{
 const start=CLOUD_BROWSER_CONTROLLER.indexOf('        elif operation in ("type", "secure_type"):');
 const branch=CLOUD_BROWSER_CONTROLLER.slice(start,CLOUD_BROWSER_CONTROLLER.indexOf('        elif operation == "select":',start)).replace('        elif ','        if ').split('\n').map(l=>l.slice(4)).join('\n');
 const result=spawnSync('python3',['-c',`import json\nsleeps=[]\nclass Time:\n def sleep(self,seconds):sleeps.append(seconds)\ntime=Time()\n`+String.raw`
class C:
 def type_keys(self,*args,**kwargs):pass
cdp=C()
reads=[]
fills=[]
marks=[]
field={'type':'text','contextId':1}
def describe(*args):return field
def replace_field_text(*args,**kwargs):fills.append(kwargs)
def snapshot(*args):reads.append(True);return {'full':True}
def evaluate(*args):return True
def mark_secure_target(*args):marks.append(True)
`+`\ndef run(payload,operation='type'):\n${branch}\n    return value\n`+String.raw`
p={'ref':'e1','text':'ordinary','deferObservation':True}
assert run(p)=={'observationDeferred':True} and not reads
assert not sleeps, 'Deferred fill added a per-field settling pause'
assert run({**p,'deferObservation':False})=={'full':True}
assert run({**p,'append':True})=={'full':True}
assert run(p,'secure_type')=={'full':True}
assert marks and fills[-1]['require_focused'] is True
field['type']='password'
try:run(p)
except RuntimeError:pass
else:raise AssertionError('Ordinary deferred fill bypassed password guard')
assert len(reads)==3
assert sleeps==[.15,.15,.15]
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
