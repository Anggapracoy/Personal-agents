import { spawnSync } from "node:child_process";
import { CLOUD_BROWSER_CONTROLLER } from "../lib/harness/browser/cloud-controller";

// Opt-in paid Browserless smoke. No account profile is read or saved. The
// fixture uses a disposable page; no user session is touched.
// node --env-file=.env.local --import tsx scripts/browserless-typing-benchmark.ts [--direct-network]
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

        op('navigate', {'url':'https://example.com/'})
        # Identical ordinary-input events, including a key-driven suggestion.
        cdp = ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
        frame = cdp.command('Page.getFrameTree')['frameTree']['frame']['id']
        html = """<title>Typing parity</title><label>Instructions<textarea></textarea></label><output></output><script>
        window.events=[]; const field=document.querySelector('textarea');
        for(const kind of ['keydown','keyup','beforeinput','input']) field.addEventListener(kind,e=>events.push({kind,key:e.key,data:e.data,value:field.value,trusted:e.isTrusted}));
        field.addEventListener('keyup',()=>document.querySelector('output').textContent=field.value);
        </script>"""
        cdp.command('Page.setDocumentContent', {'frameId':frame,'html':html})
        cdp.close()
        page=op('snapshot')
        ref=next(e['ref'] for e in page['elements'] if e.get('tag')=='textarea' or e.get('role')=='textbox')
        fast=ns['replace_field_text']
        source=controller[controller.index('def replace_field_text('):controller.index('def controlled_field_text(')]
        exec(source.replace('if not require_focused and hasattr(cdp, "type_keys"):', 'if False:'),ns)
        slow=ns['replace_field_text']
        text='Please make the rib eye steak boneless and cook it medium. If only bone-in steak is available, please contact me before preparing the order.'
        traces=[]
        for mode, implementation in [('baseline',slow),('optimized',fast)]:
            ns['replace_field_text']=implementation
            cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
            ns['evaluate'](cdp,"(document.querySelector('textarea').value='',window.events=[])")
            cdp.close()
            started=time.monotonic()
            result=op('type',{'ref':ref,'text':text})
            elapsed=round((time.monotonic()-started)*1000)
            cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
            trace=ns['evaluate'](cdp,"({events,value:document.querySelector('textarea').value,suggestion:document.querySelector('output').textContent})")
            cdp.close()
            assert trace['value']==text and trace['suggestion']==text
            assert all(e['trusted'] for e in trace['events'])
            traces.append(trace)
            print(json.dumps({'mode':mode,'elapsedMs':elapsed,'events':len(trace['events'])}),flush=True)
        assert traces[0]==traces[1], 'Native keyboard/input event trace changed'
        print('PASS exact native input event parity and key-driven suggestions',flush=True)
        append_fast=ns['CDP'].type_keys
        def append_slow(self,text,delay=0):
            for character in text:
                self.command('Input.dispatchKeyEvent',{'type':'keyDown','key':character,'text':character,'unmodifiedText':character})
                self.command('Input.dispatchKeyEvent',{'type':'keyUp','key':character})
        traces=[]
        for mode,implementation in [('append-baseline',append_slow),('append-optimized',append_fast)]:
            ns['CDP'].type_keys=implementation
            cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
            ns['evaluate'](cdp,"(document.querySelector('textarea').value='Existing: ',document.querySelector('textarea').setSelectionRange(10,10),window.events=[])")
            cdp.close()
            started=time.monotonic()
            op('type',{'ref':ref,'text':text,'append':True})
            elapsed=round((time.monotonic()-started)*1000)
            cdp=ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
            trace=ns['evaluate'](cdp,"({events,value:document.querySelector('textarea').value,suggestion:document.querySelector('output').textContent})")
            cdp.close()
            assert trace['value']=='Existing: '+text and trace['suggestion']==trace['value']
            assert all(e['trusted'] for e in trace['events'])
            traces.append(trace)
            print(json.dumps({'mode':mode,'elapsedMs':elapsed,'events':len(trace['events'])}),flush=True)
        assert traces[0]==traces[1], 'Append native keyboard/input event trace changed'
        print('PASS append native event parity and key-driven suggestions',flush=True)

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
if (result.error) console.error("Browserless typing smoke could not finish within its time limit.");
process.exitCode = result.status ?? 1;
