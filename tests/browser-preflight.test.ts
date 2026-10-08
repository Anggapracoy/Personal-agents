import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from './helpers/process';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
import { BrowserlessCloudBrowserProvider } from '../lib/harness/browser/cloud';

test('consolidated preflight retains ordering and rejects removed or changed targets', () => {
  const start = CLOUD_BROWSER_CONTROLLER.indexOf('def preflight_ref(');
  const source = CLOUD_BROWSER_CONTROLLER.slice(start, CLOUD_BROWSER_CONTROLLER.indexOf('def inspect_ref(', start));
  const result = spawnSync('python3', ['-c', source + `
original = {"name":"Message", "tag":"input", "type":"text", "href":"", "disabled":False}
def probe(after, elements):
    calls = []
    def fake_describe(cdp, ref):
        calls.append("describe")
        return dict(original if len(calls) == 1 else after)
    def fake_snapshot(cdp):
        calls.append("snapshot")
        return {"elements":elements, "url":"https://example.com"}
    globals()["describe"] = fake_describe
    globals()["snapshot"] = fake_snapshot
    try:
        return preflight_ref(None,"e1"), calls, None
    except RuntimeError as error:
        return None, calls, str(error)
value,calls,error = probe(dict(original, disabled=True, implicitSubmission=True, formSubmitter={"name":"Send"}), [{"ref":"e1"}])
assert error is None and calls == ["describe","snapshot","describe"]
assert value["element"]["disabled"] is True and value["element"]["formSubmitter"]["name"] == "Send"
for key,new_value in [("name","Pay now"),("tag","button"),("type","password"),("href","https://other.example")]:
    value,calls,error = probe(dict(original, **{key:new_value}), [{"ref":"e1"}])
    assert value is None and "changed while inspecting" in error
    assert calls == ["describe","snapshot","describe"]
value,calls,error = probe(original, [])
assert value is None and "Stale browser reference" in error
assert calls == ["describe","snapshot"]
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('provider preflight uses one RPC, returns fresh evidence and invalidates failed evidence', async () => {
  const browser = new BrowserlessCloudBrowserProvider();
  const internal = browser as unknown as { run: (operation: string, payload: unknown) => Promise<unknown> };
  const calls: unknown[] = [];
  internal.run = async (operation, payload) => {
    calls.push({ operation, payload });
    return { page: { title:'Form',url:'https://example.com/form',text:'Form',elements:[{ref:'e1',name:'Message',tag:'input',type:'text',role:'textbox',disabled:false,href:'',checked:null}],activeModalCount:0 }, element: { name:'Message',tag:'input',type:'text',href:'',implicitSubmission:true,formSubmitter:{name:'Send'} } };
  };
  const result = await browser.preflightRef('e1');
  assert.deepEqual(calls, [{ operation:'preflight_ref',payload:{ref:'e1'} }]);
  assert.equal(result.element.formSubmitter?.name, 'Send');
  assert.match(result.page.formatted, /Message/);
  assert.equal(browser.currentUrl(), 'https://example.com/form');
  await assert.rejects(browser.preflightRef('invalid'), /Invalid browser element/);
  assert.equal(calls.length, 1);
  internal.run = async () => { throw new Error('Browser reference changed while inspecting'); };
  await assert.rejects(browser.preflightRef('e1'), /changed while inspecting/);
  assert.equal(browser.currentUrl(), 'about:blank');
});

test('routine preflight reads current target semantics without a full page scan', () => {
  const start = CLOUD_BROWSER_CONTROLLER.indexOf('def preflight_ref(');
  const source = CLOUD_BROWSER_CONTROLLER.slice(start, CLOUD_BROWSER_CONTROLLER.indexOf('def inspect_ref(', start));
  const result = spawnSync('python3', ['-c', source + `
calls=[]
def describe(cdp,ref):
 calls.append('describe')
 return {'name':'Search','tag':'input','disabled':False,'implicitSubmission':True,'formSubmitter':{'name':'Send'}}
def snapshot(cdp): raise AssertionError('unnecessary full-page scan')
def evaluate(cdp,expression): return {'url':'https://example.test','title':'Current page'}
result=preflight_ref(None,'e3',False)
assert calls==['describe']
assert result['element']['formSubmitter']['name']=='Send'
assert result['page']['scopeRef']=='e3'
assert result['page']['elements'][0]['ref']=='e3'
`], {encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
