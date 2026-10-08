import { spawnSync } from "node:child_process";
import { CLOUD_BROWSER_CONTROLLER } from "../lib/harness/browser/cloud-controller";

// Opt-in paid Browserless smoke. No account profile is read or saved. The
// fixture uses only dummy card data in a disposable cross-origin iframe.
// node --env-file=.env.local --import tsx scripts/browserless-focus-smoke.ts [--direct-network]
const directNetwork = process.argv.includes("--direct-network");
const program = `controller = ${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\ndirect_network = ${directNetwork ? "True" : "False"}\n` + String.raw`
import base64, contextlib, io, json, os, tempfile, time, urllib.parse
with tempfile.TemporaryDirectory() as directory:
    controller_path = directory+'/controller.py'
    with open(controller_path, 'w') as handle: handle.write(controller)
    ns = {'__name__': 'browserless_focus_smoke', '__file__': controller_path}
    exec(controller, ns)
    ns.update(ROOT=directory, TARGET_DIR=directory, BROWSER_STATE_PATH=directory+'/state.json',
              SECRET_KEY_DIR=directory+'/keys', CURRENT_TARGET_KEY='smoke')
    os.environ['BROWSERLESS_PROFILE'] = 'dash-focus-smoke'
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

        child = '<label>CVV<input id="cvv" name="cvv" autocomplete="cc-csc" maxlength="4"></label><label>Other<input id="other"></label>'
        child_url = 'https://httpbin.org/base64/'+urllib.parse.quote(base64.b64encode(child.encode()).decode(), safe='')
        html = '<h1>Hosted field focus test</h1><input aria-label="Parent"><iframe title="Hosted card" style="margin:80px;width:500px;height:250px" src="'+child_url+'"></iframe>'
        url = 'https://example.com/'
        page = op('navigate', {'url':url})
        cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
        try:ns['evaluate'](cdp, 'document.body.innerHTML = '+json.dumps(html))
        finally:cdp.close()
        page=op('wait',{'milliseconds':1500})
        for attempt in range(8):
            fields = [e for e in page['elements'] if e['name']=='CVV']
            if fields: break
            page = op('wait', {'milliseconds':1000})
        assert fields, 'CVV fixture unavailable: '+page['text'][:300]
        ref = fields[0]['ref']
        def focus_state():
            cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
            try:
                e=ns['describe'](cdp,ref)
                state=ns['evaluate'](cdp, '({focused:document.hasFocus(),active:document.activeElement?.id})', e['contextId'], e.get('sessionId'))
                return {'field':state,'parent':ns['evaluate'](cdp, '({focused:document.hasFocus(),active:document.activeElement?.tagName})'),'oopif':bool(e.get('sessionId'))}
            finally:cdp.close()
        op('click',{'ref':ref})
        print('FOCUS_AFTER_CLICK',json.dumps(focus_state()),flush=True)
        op('secure_target',{'ref':ref})
        # Model thinking, viewer activity and a phone unlock can remove focus.
        # Secure fill must focus its explicit destination inside the same RPC.
        cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
        try:
            e=ns['describe'](cdp,ref)
            ns['evaluate'](cdp,'document.activeElement.blur()',e['contextId'],e.get('sessionId'))
        finally:cdp.close()
        os.makedirs(ns['SECRET_KEY_DIR'], exist_ok=True)
        ns['decrypt_device_envelope'] = lambda *args: {'kind':'payment_card','securityCode':'123'}
        filled=op('secure_fill_envelope', {'token':'a'*32,'kind':'payment_card','envelope':{},'fields':[{'name':'securityCode','ref':ref}],'expectedUrl':page['url']})
        assert filled['secureFieldsVerified'] and filled['secureFieldNames']==['securityCode']
        other=next(e for e in filled['elements'] if e['name']=='Other')
        assert other.get('value','')==''
        op('click',{'ref':other['ref']})
        op('secure_target',{'ref':ref})
        assert focus_state()['field']['active']=='cvv'
        print('PASS: dummy hosted CVC securely filled after focus loss; other field untouched; explicit destination focused',flush=True)
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
if (result.error) console.error("Browserless focus smoke could not finish within its time limit.");
process.exitCode = result.status ?? 1;
