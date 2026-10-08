import { spawnSync } from "node:child_process";
import { CLOUD_BROWSER_CONTROLLER } from "../lib/harness/browser/cloud-controller";

// Opt-in paid Browserless smoke. No account profile is read or saved. The
// fixture captures a disposable background page; no user session is touched.
// node --env-file=.env.local --import tsx scripts/browserless-screenshot-smoke.ts [--direct-network]
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
        cdp = ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws'])+'#'+target_id)
        try: ns['evaluate'](cdp, "document.body.style.background='rgb(255,0,0)'")
        finally: cdp.close()
        # Keep this isolated page in the background, as it was in the failing run.
        other = ns['json_request']('/json/new?about%3Ablank', 'PUT')
        for index in range(3):
            started = time.monotonic()
            result = op('screenshot', {'path':directory+'/screenshot-'+str(index)+'.png'})
            with open(result['path'],'rb') as image:
                assert image.read(8) == b'\x89PNG\r\n\x1a\n'
            import shutil
            shutil.copyfile(result['path'], '/tmp/dash-capture-'+str(index)+'.png')
            print(json.dumps({'iteration':index,'totalMs':round((time.monotonic()-started)*1000),'captureAttempts':result['captureAttempts']}),flush=True)
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
if (result.error) console.error("Browserless screenshot smoke could not finish within its time limit.");
process.exitCode = result.status ?? 1;
