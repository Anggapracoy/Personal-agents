import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { EXTENDED_BROWSER_CONTROLLER } from '../lib/harness/browser/extended-controller';
import { extendedBrowserSchema } from '../lib/harness/browser/extended-schema';
import { runBrowserScript } from '../lib/harness/browser/script';

test('locator waiting uses one guarded query and preserves tab, frame and scope', async () => {
  const calls: Array<{name:string;input:any}> = [];
  const result = await runBrowserScript(`const p=browser.tab('a').frame('child'); await p.getByRole('dialog').getByRole('button',{name:'Next'}).waitFor({state:'enabled',timeoutMs:5000}); print(await p.getByText('Ready').innerText());`, async (name, input) => {
    calls.push({name,input});
    return name === 'browser_extended' ? {matches:[{text:'Ready',visible:true,enabled:true}]} : {};
  });
  assert.equal(result.$toolError, undefined);
  assert.deepEqual(result.printed, ['Ready']);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].input.action, 'tabs_select');
  assert.deepEqual(calls[1].input.poll, {state:'enabled',timeoutMs:5000});
  assert.equal(calls[1].input.locator.frame, 'child');
  assert.equal(calls[1].input.locator.scopes[0].role, 'dialog');
  assert.deepEqual(calls[2].input.poll, {state:'attached',timeoutMs:3000});
  for (const call of calls) extendedBrowserSchema.parse(call.input);
});

test('failed waits stop the script, and ambiguous reads never dispatch input', async () => {
  let calls=0;
  const failed=await runBrowserScript(`try{await browser.page().getByText('Ready').waitFor()}catch(e){} await browser.page().goto('https://example.com');`,async()=>{calls++;throw Error('transport lost');});
  assert.equal(failed.$toolError,true);assert.equal(calls,1);
  calls=0;
  const ambiguous=await runBrowserScript(`print(await browser.page().getByText('Ready').innerText()); await browser.page().goto('https://example.com');`,async()=>{calls++;return {matches:[{},{}]};});
  assert.equal(ambiguous.$toolError,true);assert.match(String(ambiguous.error),/matched 2/);assert.equal(calls,1);
});

test('controller polling returns immediately on fresh evidence, with no full-page scans', () => {
  const start=EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_poll_query(');
  const source=EXTENDED_BROWSER_CONTROLLER.slice(start,EXTENDED_BROWSER_CONTROLLER.indexOf('def extended_secure_page(',start));
  const result=spawnSync('python3',['-c',source+String.raw`
class Clock:
 def __init__(self):self.now=0;self.sleeps=[]
 def monotonic(self):return self.now
 def sleep(self,n):self.now+=n;self.sleeps.append(n)
class CDP:frame_context_warnings=[]
time=Clock();cdp=CDP();reads=[]
def snapshot(*args):raise AssertionError('Full page scan during locator wait')
def extended_query(cdp,locator):
 reads.append(locator)
 return [{'visible':time.now>=.6,'enabled':time.now>=.6,'text':'Fresh'}]
assert extended_poll_query(cdp,{'frame':'child'},{'state':'visible','timeoutMs':5000})[0]['text']=='Fresh'
assert .6<=time.now<.8 and len(reads)==5
before=time.now
assert extended_poll_query(cdp,{}, {'state':'enabled','timeoutMs':5000})
assert time.now==before, 'Ready control incurred a sleep'
def extended_query(cdp,locator):return [{},{}]
assert len(extended_poll_query(cdp,{}, {'state':'attached','timeoutMs':3000}))==2
assert time.now==before, 'Ambiguity must not be waited away'
def extended_query(cdp,locator):return []
cdp.frame_context_warnings=['unavailable child']
try:extended_poll_query(cdp,{}, {'state':'hidden','timeoutMs':300})
except RuntimeError as e:assert 'timed out' in str(e)
else:raise AssertionError('Incomplete frame observation accepted as hidden')
cdp.frame_context_warnings=[]
assert extended_poll_query(cdp,{}, {'state':'hidden','timeoutMs':0})==[]
before=time.now
assert extended_poll_query(cdp,{}, {'state':'attached','timeoutMs':310})==[]
assert abs(time.now-before-.310)<.001
def extended_query(cdp,locator):raise RuntimeError('transport lost')
before=time.now
try:extended_poll_query(cdp,{}, {'state':'visible','timeoutMs':5000})
except RuntimeError as e:assert str(e)=='transport lost'
else:raise AssertionError('Transport failure swallowed')
assert time.now==before
`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
