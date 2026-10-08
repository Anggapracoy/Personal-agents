import { spawnSync } from "node:child_process";
import { CLOUD_BROWSER_CONTROLLER } from "../lib/harness/browser/cloud-controller";

// Opt-in paid Browserless smoke. No account profile is read or saved. The
// default fixture uses dummy credentials; --x only observes the public form.
// node --env-file=.env.local --import tsx scripts/browserless-ref-smoke.ts [--x] [--initial] [--direct-network]
const liveX = process.argv.includes("--x");
const initialPage = process.argv.includes("--initial");
const directNetwork = process.argv.includes("--direct-network");
const program = `controller = ${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\nlive_x = ${liveX ? "True" : "False"}\ninitial_page = ${initialPage ? "True" : "False"}\ndirect_network = ${directNetwork ? "True" : "False"}\n` + String.raw`
import base64, contextlib, io, json, os, tempfile, time, urllib.parse
with tempfile.TemporaryDirectory() as directory:
    controller_path = directory+'/controller.py'
    with open(controller_path, 'w') as handle: handle.write(controller)
    ns = {'__name__': 'browserless_ref_smoke', '__file__': controller_path}
    exec(controller, ns)
    ns.update(ROOT=directory, TARGET_DIR=directory, BROWSER_STATE_PATH=directory+'/state.json',
              SECRET_KEY_DIR=directory+'/keys', CURRENT_TARGET_KEY='smoke')
    os.environ['BROWSERLESS_PROFILE'] = 'dash-ref-smoke'
    os.environ['BROWSERLESS_SESSION_TIMEOUT_MS'] = '120000'
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
        target = (ns['choose_target']('smoke') if initial_page else
                  ns['json_request']('/json/new?about%3Ablank', 'PUT'))
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

        forms = '<form><label>Email<input name="email"></label></form><form><input name="username"></form>'
        html = '<main id="fields">'+forms+'</main><script>addEventListener("resize",()=>{document.getElementById("fields").innerHTML='+json.dumps(forms)+'})</script>'
        url = 'https://x.com/i/flow/login' if live_x else 'https://httpbin.org/base64/'+urllib.parse.quote(base64.b64encode(html.encode()).decode(), safe='')
        op('navigate', {'url': url})
        page = op('wait', {'milliseconds': 5000 if live_x else 500})
        fields = [e for e in page['elements'] if e['tag']=='input' and e['role']=='textbox']
        if live_x:
            for attempt in range(5):
                if fields: break
                page = op('wait', {'milliseconds':5000})
                fields = [e for e in page['elements'] if e['tag']=='input' and e['role']=='textbox']
        assert len(fields) >= (1 if live_x else 2), 'Login fields not exposed: '+json.dumps({'url':page['url'],'title':page['title'],'text':page['text'][:700]})
        for field in fields:
            op('describe', {'ref': field['ref']})
            op('inspect', {'ref': field['ref']})
        op('screenshot', {'path': directory+'/screenshot-page.png'})
        for field in fields:
            op('describe', {'ref': field['ref']})
        if not live_x:
            os.makedirs(ns['SECRET_KEY_DIR'], exist_ok=True)
            ns['decrypt_device_envelope'] = lambda *args: {'kind':'login','username':'fixture-user','password':'fixture-password'}
            op('click', {'ref':fields[0]['ref']})
            filled = op('secure_fill_envelope', {'token':'a'*32,'kind':'login','envelope':{},
                                                'fields':[{'name':'username','ref':fields[0]['ref']}], 'expectedUrl':page['url']})
            assert filled['secureFieldsVerified'] and filled['secureFieldNames']==['username']
            selected = next(e for e in filled['elements'] if e['ref']==fields[0]['ref'])
            other = next(e for e in filled['elements'] if e['ref']==fields[1]['ref'])
            assert selected['valueRedacted'] and 'value' not in selected
            assert other.get('value','') == ''
            cdp = ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
            try:
                assert ns['evaluate'](cdp, 'Array.from(document.querySelectorAll("input")).map(e=>e.value)') == ['fixture-user','']
            finally:
                cdp.close()
        print('PASS: refs survived reconnects, inspection, and screenshot; '+
              ('X was observed without entering credentials' if live_x else 'only the selected fixture field was securely filled'), flush=True)
    finally:
        connection = ns['BROWSER_CONNECTION']
        try:
            connection.command('Browser.close')
        finally:
            connection.close()
`;
const result = spawnSync("python3", ["-c", program], { env: process.env, encoding: "utf8", timeout: 150_000 });
// The trusted controller sanitizes upstream URLs; avoid printing a child-process
// exception whose command argument embeds controller code or test settings.
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr.replaceAll(process.env.BROWSERLESS_API_TOKEN ?? "__missing_token__", "[redacted]"));
if (result.error) console.error("Browserless reference smoke could not finish within its time limit.");
process.exitCode = result.status ?? 1;
