import { spawnSync } from "node:child_process";
import { CLOUD_BROWSER_CONTROLLER } from "../lib/harness/browser/cloud-controller";

// Disposable two-click visual check through the same Browserless controller as runs.
// node --env-file=.env.local --import tsx scripts/browserless-cursor-demo.ts
const output = process.argv[2] || "/tmp/browserless-cursor-demo.mp4";
const program = `controller = ${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\noutput = ${JSON.stringify(output)}\n` + String.raw`
import base64, contextlib, io, json, os, socket, subprocess, tempfile, threading, time

with tempfile.TemporaryDirectory() as directory:
    controller_path = directory + '/controller.py'
    with open(controller_path, 'w') as handle: handle.write(controller)
    ns = {'__name__': 'browserless_cursor_demo', '__file__': controller_path}
    exec(controller, ns)
    ns.update(ROOT=directory, TARGET_DIR=directory, BROWSER_STATE_PATH=directory+'/state.json',
              SECRET_KEY_DIR=directory+'/keys', CURRENT_TARGET_KEY='cursor-demo')
    os.environ['BROWSERLESS_PROFILE'] = 'dash-cursor-demo-disposable'
    os.environ['BROWSERLESS_SESSION_TIMEOUT_MS'] = '120000'
    os.environ['DASH_CURSOR_COLOR'] = '#6685c5'
    original_api = ns['browserless_api']
    def api(path, *args, **kwargs):
        if path.startswith('/profile/'):
            raise RuntimeError('Browserless API returned HTTP 404')
        return original_api(path, *args, **kwargs)
    ns['browserless_api'] = api
    ns['checkpoint_profile'] = lambda *args: None
    ns['connect_browser']({'operation': 'navigate'})
    try:
        target = ns['json_request']('/json/new?about%3Ablank', 'PUT')
        target_id = target['id']
        endpoint = ns['browserless_url'](ns['BROWSER_STATE']['ws']) + '#' + target_id
        def op(name, payload=None):
            captured = io.StringIO()
            try:
                with contextlib.redirect_stdout(captured):
                    ns['execute_request']({'operation':name,'payload':payload or {}}, {'id':target_id,'webSocketDebuggerUrl':endpoint})
                value = json.loads(captured.getvalue())['value']
            finally:
                ns['finish_browser']()
                ns['BROWSER_CONNECTION'] = ns['CDP'](ns['browserless_url'](ns['BROWSER_STATE']['ws']))
                ns['BROWSER_STATE'] = json.load(open(ns['BROWSER_STATE_PATH']))
            return value

        op('navigate', {'url':'https://example.com/'})
        cdp = ns['CDP'](endpoint)
        try:
            html = '''<style>
                *{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#182236;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
                header{height:74px;padding:22px 54px;background:#fff;border-bottom:1px solid #e5e9ef;font-size:20px;font-weight:650}
                main{max-width:1280px;margin:66px auto;padding:0 40px}h1{font-size:38px;letter-spacing:-.04em;margin:0 0 12px}p{font-size:18px;color:#627086}
                .steps{display:grid;grid-template-columns:1fr 1fr;gap:38px;margin-top:68px}.card{background:white;border:1px solid #e1e7f0;border-radius:22px;padding:45px;min-height:360px;box-shadow:0 12px 35px #16263b0b}
                .num{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;background:#e5ebf8;color:#486bb3;font-size:19px;font-weight:700}
                h2{font-size:27px;letter-spacing:-.025em;margin:34px 0 9px}.card p{font-size:17px;line-height:1.45;min-height:55px}
                button{margin-top:20px;border:0;border-radius:12px;background:#2463db;color:white;font-size:18px;font-weight:620;padding:17px 25px;cursor:pointer;min-width:184px}
                button:hover{background:#144fc5}button:disabled{background:#7da0de}.status{margin-top:28px;font-size:17px;color:#486bb3;font-weight:600}
            </style><header>Browserless cursor check</header><main><h1>Two-step task</h1><p>Watch the cursor at full desktop page scale as the harness moves and clicks.</p>
            <div class="steps"><section class="card"><div class="num">1</div><h2>Choose an option</h2><p>Select the first button to enable the next step.</p><button id="first">Select option</button><div id="one-status" class="status">Waiting</div></section>
            <section class="card"><div class="num">2</div><h2>Confirm selection</h2><p>Move across the page and click to finish.</p><button id="second" disabled>Confirm</button><div id="two-status" class="status">Waiting</div></section></div></main>'''
            ns['evaluate'](cdp, "(() => {document.body.innerHTML="+json.dumps(html)+";document.getElementById('first').addEventListener('click',()=>{document.getElementById('one-status').textContent='Selected ✓';document.getElementById('second').disabled=false;});document.getElementById('second').addEventListener('click',()=>{document.getElementById('two-status').textContent='Confirmed ✓';});return true})()")
        finally: cdp.close()

        page = op('snapshot')
        first = next(e for e in page['elements'] if e['tag']=='button' and e['name']=='Select option')
        live = op('live_url',{'control':False})['url']
        viewer_output = output.replace('.mp4','-viewer.webm')
        recorder_js = r'''
const { chromium } = require('@playwright/test');
const fs = require('fs');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:process.argv[2],size:{width:1440,height:900}}});
  const page=await context.newPage();
  await page.goto(process.argv[1],{waitUntil:'domcontentloaded',timeout:25000});
  console.log('READY');
  await new Promise(resolve=>process.stdin.once('data',resolve));
  await context.close();
  fs.copyFileSync(await page.video().path(),process.argv[3]);
  // The video has been finalized; Browserless's live transport can otherwise
  // keep Playwright's shutdown pending after this disposable run is complete.
  process.exit(0);
})().catch(error=>{console.error(error.message);process.exit(1)});
'''
        viewer = subprocess.Popen(['node','-e',recorder_js,live,directory,viewer_output],cwd=os.getcwd(),
                                  stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        if viewer.stdout.readline().strip() != 'READY':
            raise RuntimeError('Browserless live viewer recording could not open: '+viewer.stderr.read()[:300])
        frames = directory + '/frames'
        os.makedirs(frames)
        stop = threading.Event()
        errors = []
        timing = {}
        def record():
            recorder = None
            try:
                # A separate socket avoids contending with the controller's
                # pooled action connection while Chrome streams page frames.
                recorder = ns['DirectCDP'](endpoint)
                recorder.command('Page.enable')
                recorder.command('Page.startScreencast', {'format':'jpeg','quality':85,'maxWidth':1440,'maxHeight':900,'everyNthFrame':1})
                index = 0
                while not stop.is_set():
                    recorder.sock.settimeout(.3)
                    try: message = recorder.receive()
                    except socket.timeout: continue
                    if message.get('method') != 'Page.screencastFrame': continue
                    params = message['params']
                    timing.setdefault('first',time.monotonic())
                    timing['last'] = time.monotonic()
                    with open(frames+'/%05d.jpg'%index,'wb') as file:
                        file.write(base64.b64decode(params['data']))
                    index += 1
                    ack = {'id':recorder.next_id,'method':'Page.screencastFrameAck','params':{'sessionId':params['sessionId']}}
                    recorder.next_id += 1
                    if recorder.page_session: ack['sessionId'] = recorder.page_session
                    recorder.send(ack)
            except Exception as error:
                errors.append(str(error))
            finally:
                if recorder:
                    try: recorder.command('Page.stopScreencast', timeout=2)
                    except Exception: pass
                    recorder.close()
        thread = threading.Thread(target=record,daemon=True)
        thread.start()
        time.sleep(.6)
        op('hover', {'ref':first['ref']})
        time.sleep(.5)
        op('click', {'ref':first['ref']})
        time.sleep(.6)
        page = op('snapshot')
        assert 'Selected' in page['text'], 'First click did not register'
        second = next(e for e in page['elements'] if e['tag']=='button' and e['name']=='Confirm')
        op('click', {'ref':second['ref']})
        time.sleep(1.1)
        page = op('snapshot')
        assert 'Confirmed' in page['text'], 'Second click did not register'
        viewer.stdin.write('stop\n')
        viewer.stdin.flush()
        viewer.wait(timeout=20)
        if viewer.returncode: raise RuntimeError('Browserless viewer recording failed: '+viewer.stderr.read()[:300])
        stop.set()
        thread.join(8)
        if errors: raise RuntimeError('Recording failed: '+errors[0])
        count = len(os.listdir(frames))
        if count < 8: raise RuntimeError('Too few recorded frames: '+str(count))
        fps = max(4,min(60,round((count-1)/max(.1,timing['last']-timing['first']))))
        os.makedirs(os.path.dirname(output),exist_ok=True)
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate',str(fps),'-i',frames+'/%05d.jpg',
                        '-vf','scale=1440:-2,format=yuv420p','-c:v','libx264','-crf','18','-movflags','+faststart',output],check=True)
        print(json.dumps({'video':output,'viewerVideo':viewer_output,'frames':count,'fps':fps,'page':page['url'],'first':'Selected','second':'Confirmed'}),flush=True)
    finally:
        connection = ns['BROWSER_CONNECTION']
        try: connection.command('Browser.close')
        finally: connection.close()
`;
const result = spawnSync("python3", ["-c", program], { env: process.env, encoding: "utf8", timeout: 180_000 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr.replaceAll(process.env.BROWSERLESS_API_TOKEN ?? "__missing_token__", "[redacted]"));
if (result.error) console.error("Browserless cursor demo timed out.");
process.exitCode = result.status ?? 1;
