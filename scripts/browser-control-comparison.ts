import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { CLOUD_BROWSER_CONTROLLER } from "../lib/harness/browser/cloud-controller";
import { formatDomSnapshot, type BrowserSnapshot } from "../lib/harness/browser/cloud";
import { browserSnapshotContext, withBrowserObservationDiffs } from "../lib/harness/browser/observation-diff";
import { resolveBrowserTarget } from "../lib/harness/browser/policy";
import type { ModelMessage } from "ai";

// Opt-in live comparison capture using disposable pages and dummy values only.
// node --env-file=.env.local --import tsx scripts/browser-control-comparison.ts [--direct-network]
mkdirSync("artifacts/browser-control-comparison", { recursive: true });
const child = '<label>CVV<input autocomplete="off"></label><label>Other<input></label>';
const childUrl = 'https://httpbin.org/base64/' + encodeURIComponent(Buffer.from(child).toString('base64'));
const fixture = `<!doctype html><title>Control comparison fixture</title><h1>Control comparison</h1><label>Quantity<input type="number" value="2" min="1"></label><button onclick="this.disabled=true;document.getElementById('state').textContent='Loading';setTimeout(()=>{document.getElementById('next').outerHTML='<button id=next>Continue</button>';document.getElementById('state').textContent='Ready'},1200)">Load next step</button><button id="next" disabled>Continue</button><p id="state" role="status">Waiting</p><iframe title="Hosted card fields" src="${childUrl}"></iframe><div id="shadow-host"></div><div role="switch" aria-checked="false" aria-label="Email alerts" onclick="this.setAttribute('aria-checked',String(this.getAttribute('aria-checked')!=='true'))">Email alerts</div><script>document.getElementById("shadow-host").attachShadow({mode:"open"}).innerHTML='<section role=region aria-label=Shadow><button onclick=this.textContent=123>Shadow action</button><label>Shadow input<input></label></section>'</script>`;
writeFileSync("artifacts/browser-control-comparison/fixture-url.txt", 'https://www.httpbin.org/base64/' + encodeURIComponent(Buffer.from(fixture).toString('base64')));
if (Buffer.from(fixture).toString("base64").includes("/")) throw new Error("Fixture base64 contains a slash unsupported by the public host route");
const directNetwork = process.argv.includes("--direct-network");
const program = `controller = ${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\ndirect_network = ${directNetwork ? "True" : "False"}\n` + String.raw`
import base64, contextlib, io, json, os, tempfile, time, urllib.parse
with tempfile.TemporaryDirectory() as directory:
    controller_path = directory+'/controller.py'
    with open(controller_path, 'w') as handle: handle.write(controller)
    ns = {'__name__': 'browser_control_comparison', '__file__': controller_path}
    exec(controller, ns)
    ns.update(ROOT=directory, TARGET_DIR=directory, BROWSER_STATE_PATH=directory+'/state.json',
              SECRET_KEY_DIR=directory+'/keys', CURRENT_TARGET_KEY='smoke')
    os.environ['BROWSERLESS_PROFILE'] = 'dash-control-comparison'
    os.environ['BROWSERLESS_SESSION_TIMEOUT_MS'] = '240000'
    original_api = ns['browserless_api']
    def api(path, *args, **kwargs):
        if path.startswith('/profile/'):
            raise RuntimeError('Browserless API returned HTTP 404')
        if direct_network and path.startswith('/stealth/bql?'):
            route, query = path.split('?',1)
            path = route+'?'+urllib.parse.urlencode({key:value for key,value in urllib.parse.parse_qsl(query) if not key.startswith('proxy')})
        return original_api(path, *args, **kwargs)
    ns['browserless_api'] = api
    ns['checkpoint_profile'] = lambda *args: None
    ns['connect_browser']({'operation': 'navigate'})
    root = ns['BROWSER_CONNECTION']
    try:
        target = ns['json_request']('/json/new?about%3Ablank', 'PUT')
        target_id = target['id']
        def op(name, payload=None):
            capture = io.StringIO()
            try:
                with contextlib.redirect_stdout(capture):
                    ns['execute_request']({'operation': name, 'payload': payload or {}}, {
                        'id': target_id,
                        'webSocketDebuggerUrl': ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id,
                    })
                value = json.loads(capture.getvalue())['value']
            finally:
                ns['finish_browser']()
                ns['BROWSER_CONNECTION'] = ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws']))
            # Each tool call runs in a fresh process in production. Restore the
            # persisted state, and fully reconnect rather than retaining CDP.
            ns['BROWSER_STATE'] = json.load(open(ns['BROWSER_STATE_PATH']))
            print('passed', name, flush=True)
            return value

        def capture(label, name, payload=None):
            started=time.monotonic()
            value=op(name,payload)
            result={'label':label,'operation':name,'elapsedMs':round((time.monotonic()-started)*1000),'value':value}
            with open('artifacts/browser-control-comparison/'+label+'.json','w') as handle:json.dump(result,handle,indent=2)
            print('CAPTURE',label,result['elapsedMs'],flush=True)
            return value
        page=capture('cloud-form-initial','navigate',{'url':'https://www.selenium.dev/selenium/web/web-form.html'})
        for role,name in [('combobox','Dropdown (select)'),('combobox','Dropdown (datalist)'),('slider','Example range'),('button','File input'),('ColorWell','Color picker')]:
            assert len([e for e in page['elements'] if e['role']==role and e['name']==name])==1, (role,name)
        assert next(e for e in page['elements'] if e['name']=='Readonly input')['readOnly'] is True
        field=next(e for e in page['elements'] if e['name']=='Text input')
        page=capture('cloud-form-text','type',{'ref':field['ref'],'text':'Comparison text'})
        checkbox=next(e for e in page['elements'] if e['name']=='Default checkbox')
        page=capture('cloud-form-checkbox','check',{'ref':checkbox['ref'],'checked':True})
        dropdown=next(e for e in page['elements'] if e['name']=='Dropdown (select)')
        page=capture('cloud-form-expanded','click',{'ref':dropdown['ref']})
        assert next(row for row in page['axTree'] if row.get('ref')==dropdown['ref'])['expanded'] is True
        page=capture('cloud-form-collapsed','press',{'ref':dropdown['ref'],'key':'Escape'})
        assert next(row for row in page['axTree'] if row.get('ref')==dropdown['ref'])['expanded'] is False
        page=capture('cloud-form-select','select',{'ref':dropdown['ref'],'value':'Two'})
        assert next(e for e in page['elements'] if e['ref']==dropdown['ref'])['value']=='2'
        capture('cloud-form-screenshot','screenshot',{'path':directory+'/screenshot-form.png'})
        import shutil
        shutil.copyfile(directory+'/screenshot-form.png','artifacts/browser-control-comparison/cloud-form.png')
        fixture_url=open('artifacts/browser-control-comparison/fixture-url.txt').read()
        page=capture('cloud-fixture-initial','navigate',{'url':fixture_url})
        page=capture('cloud-fixture-loaded','snapshot')
        assert page['title']=='Control comparison fixture', 'Public fixture host did not serve the expected page'
        audit={name:{'inAX':name in page['text'],'hasRef':any(e['name']==name for e in page['elements'])} for name in ['Shadow action','Email alerts']}
        with open('artifacts/browser-control-comparison/control-coverage-audit.json','w') as handle:json.dump(audit,handle,indent=2)
        assert all(item['inAX'] and item['hasRef'] for item in audit.values()), audit
        shadow=next(e for e in page['elements'] if e['name']=='Shadow action')
        page=capture('cloud-shadow-click','click',{'ref':shadow['ref']})
        assert next(e for e in page['elements'] if e['ref']==shadow['ref'])['name']=='123'
        field=next(e for e in page['elements'] if e['name']=='Shadow input')
        page=capture('cloud-shadow-type','type',{'ref':field['ref'],'text':'Shadow works'})
        assert next(e for e in page['elements'] if e['ref']==field['ref'])['value']=='Shadow works'
        region=next(e for e in page['elements'] if e['name']=='Shadow')
        scoped=capture('cloud-shadow-inspect','inspect',{'ref':region['ref']})
        assert any(e['ref']==field['ref'] for e in scoped['elements'])
        switch=next(e for e in page['elements'] if e['name']=='Email alerts')
        page=capture('cloud-switch-check','check',{'ref':switch['ref'],'checked':True})
        assert next(e for e in page['elements'] if e['ref']==switch['ref'])['checked'] is True
        quantity=next(e for e in page['elements'] if e['name']=='Quantity')
        page=capture('cloud-fixture-quantity','type',{'ref':quantity['ref'],'text':'1'})
        trigger=next(e for e in page['elements'] if e['name']=='Load next step')
        page=capture('cloud-fixture-click','click',{'ref':trigger['ref']})
        page=capture('cloud-fixture-ready','wait_for',{'target':{'role':'button','name':'Continue'},'state':'enabled','timeoutMs':10000})
        cvv=next(e for e in page['elements'] if e['name']=='CVV')
        page=capture('cloud-fixture-cvv','type',{'ref':cvv['ref'],'text':'123'})
        final=capture('cloud-fixture-final','snapshot')
        cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
        try:
            field=ns['describe'](cdp,cvv['ref'])
            correct=ns['evaluate'](cdp, 'document.querySelectorAll("input")[0].value === "123" && document.querySelectorAll("input")[1].value === ""',field['contextId'],field.get('sessionId'))
            assert correct, 'Dummy CVV not retained or neighboring field changed'
        finally:cdp.close()
        assert next(e for e in final['elements'] if e['name']=='Quantity')['value']=='1'
        assert not next(e for e in final['elements'] if e['name']=='Continue')['disabled']
        with open('artifacts/browser-control-comparison/verified.json','w') as handle:json.dump({'dummyCvvRetained':True,'otherUntouched':True,'quantity':1,'continueEnabled':True,'shadowClick':True,'shadowType':True,'shadowScopedInspection':True,'ariaSwitchChecked':True,'dropdownExpanded':True,'dropdownCollapsed':True,'dropdownSelected':True},handle)
        print('PASS: final quantity, replacement control, and isolated dummy iframe input verified',flush=True)
    finally:
        connection = ns['BROWSER_CONNECTION']
        try:
            connection.command('Browser.close')
        finally:
            connection.close()
`;
const result = spawnSync("python3", ["-c", program], { env: process.env, encoding: "utf8", timeout: 280_000 });
// The trusted controller sanitizes upstream URLs; avoid printing a child-process
// exception whose command argument embeds controller code or test settings.
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr.replaceAll(process.env.BROWSERLESS_API_TOKEN ?? "__missing_token__", "[redacted]"));
if (result.error) console.error("Browser control comparison could not finish within its time limit.");
process.exitCode = result.status ?? 1;

if (result.status === 0) {
  const directory = "artifacts/browser-control-comparison/";
  const captures = [
    ["cloud-form-initial", "browser_open"], ["cloud-form-text", "browser_type"],
    ["cloud-form-checkbox", "browser_check"], ["cloud-form-expanded", "browser_click"],
    ["cloud-form-collapsed", "browser_press"], ["cloud-form-select", "browser_select"],
    ["cloud-fixture-initial", "browser_open"], ["cloud-fixture-loaded", "browser_inspect"],
    ["cloud-shadow-click", "browser_click"], ["cloud-shadow-type", "browser_type"],
    ["cloud-shadow-inspect", "browser_inspect"], ["cloud-switch-check", "browser_check"],
    ["cloud-fixture-quantity", "browser_type"], ["cloud-fixture-click", "browser_click"],
    ["cloud-fixture-ready", "browser_wait_for"], ["cloud-fixture-cvv", "browser_type"],
    ["cloud-fixture-final", "browser_inspect"],
  ];
  const pages = captures.map(([capture]) => JSON.parse(readFileSync(directory + capture + ".json", "utf8")).value as BrowserSnapshot);
  const messages: ModelMessage[] = captures.map(([capture, toolName], index) => {
    const page = pages[index];
    const snapshot = formatDomSnapshot(page);
    writeFileSync(directory + capture + "-single-tree.txt", snapshot);
    return { role: "tool", content: [{ type: "tool-result", toolName, toolCallId: capture, output: { type: "json", value: {
      title: page.title, url: page.url, snapshot, browserSnapshotContext: browserSnapshotContext(page)!,
    } } }] };
  });
  const prepared = withBrowserObservationDiffs(messages);
  prepared.forEach((message, index) => {
    if (message.role !== "tool") throw new Error("Unexpected comparison message");
    const part = message.content[0];
    if (part.type !== "tool-result" || part.output.type !== "json") throw new Error("Missing comparison output");
    const value = part.output.value as { snapshot: string };
    writeFileSync(directory + captures[index][0] + "-agent-return.json", JSON.stringify(value, null, 2));
    writeFileSync(directory + captures[index][0] + "-agent-output.txt", value.snapshot);
  });
  writeFileSync(directory + "single-tree-full-receipts.json", JSON.stringify(messages, null, 2));
  writeFileSync(directory + "single-tree-model-input.json", JSON.stringify(prepared, null, 2));
  const targets = [["combobox", "Dropdown (select)"], ["combobox", "Dropdown (datalist)"], ["slider", "Example range"], ["button", "File input"], ["textbox", "Text input"], ["ColorWell", "Color picker"]];
  const checks = targets.map(([role, name]) => ({ role, name, ref: resolveBrowserTarget({ role, name }, pages[0]), passed: true }));
  const fixture = pages[7];
  for (const [role, name] of [["spinbutton", "Quantity"], ["button", "Shadow action"], ["switch", "Email alerts"], ["textbox", "Shadow input"]]) checks.push({ role, name, ref: resolveBrowserTarget({ role, name }, fixture), passed: true });
  writeFileSync(directory + "semantic-target-checks.json", JSON.stringify(checks, null, 2));
}
