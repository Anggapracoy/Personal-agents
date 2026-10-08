/** Evaluation-only transport: real production controller and provider methods, local Chrome. */
import { chromium } from '@playwright/test';
import { createServer, createConnection, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserlessCloudBrowserProvider } from '../../lib/harness/browser/cloud';
import { CLOUD_BROWSER_CONTROLLER } from '../../lib/harness/browser/cloud-controller';

export async function localBrowser(userId: string, runId: string, fixture?: { url: string; html: (url: string) => string | null }) {
  const reserve = createServer();
  await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const root = await mkdtemp(join(tmpdir(), 'dash-agent-browser-'));
  const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
  // Optional evaluation-only TCP latency. Delay each direction equally; reads
  // in one CDP batch travel together rather than charging latency per command.
  const rtt = Number(process.env.BROWSER_BENCHMARK_RTT_MS ?? 0);
  if (!Number.isFinite(rtt) || rtt < 0 || rtt > 200) throw new Error('Invalid benchmark RTT');
  let controllerPort = port;
  const sockets = new Set<Socket>();
  const proxy = rtt ? createServer(inbound => {
    const upstream = createConnection({host:'127.0.0.1',port});
    sockets.add(inbound); sockets.add(upstream);
    for (const [from,to] of [[inbound,upstream],[upstream,inbound]]) {
      from.on('data',data => setTimeout(()=>{if(!to.destroyed)to.write(data)},rtt/2));
      from.on('end',()=>to.end());
      from.on('error',()=>to.destroy());
      from.on('close',()=>sockets.delete(from));
    }
  }) : null;
  if (proxy) { await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve)); controllerPort=(proxy.address() as {port:number}).port; }
  const context = await browser.newContext();
  // Public-looking fixture address retains the ordinary URL checks. No network leaves Chrome.
  const url = fixture?.url ?? 'https://form-benchmark.example/web-form.html';
  await context.route('**/*', route => fixture ? (fixture.html(route.request().url()) !== null ? route.fulfill({ contentType: 'text/html', body: fixture.html(route.request().url())! }) : route.abort()) : route.request().url() === url ? route.fulfill({
    contentType: 'text/html', body: `<title>Web form</title><h1>Web form</h1><form onsubmit="event.preventDefault();document.body.dataset.submitted='true'"><label>Text input<input></label><label>Textarea<textarea></textarea></label><label>Dropdown (select)<select><option value="1">One</option><option value="2">Two</option></select></label><label>Default checkbox<input type="checkbox"></label><label>Password<input type="password"></label><button>Submit</button></form>`,
  }) : route.abort());
  const page = await context.newPage();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; id: string }>;
  const target = targets.find(t => t.type === 'page')!;
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
  const endpoint = version.webSocketDebuggerUrl.replace('ws:', 'wss:') + '#' + target.id;
  // Evaluation-only control arm: restore the pre-fix number-input role mapping.
  const controller = process.env.BROWSER_NUMBER_ROLE_BASELINE === '1'
    ? CLOUD_BROWSER_CONTROLLER.replace("element.type === 'number' ? 'spinbutton' : ", '')
    : CLOUD_BROWSER_CONTROLLER;
  const measuredController = process.env.BROWSER_LOCATOR_BASELINE === "1"
    ? controller.replace("if(e.getAttribute('data-decision-feed-ref')!==ref)e.setAttribute('data-decision-feed-ref',ref);", "e.setAttribute('data-decision-feed-ref',ref);")
    : controller;
  const code = String.raw`
import json,ssl,socket,sys,contextlib,io
ns={'__name__':'local_test'}
exec(CONTROLLER,ns)
if LOCATOR_BASELINE: delattr(ns['DirectCDP'],'existing_locator_query')
ns['browserless_url']=lambda endpoint:endpoint
connect=socket.create_connection
socket.create_connection=lambda address,**kwargs:connect(('127.0.0.1',CONTROLLER_PORT),**kwargs)
class Plain:
 def wrap_socket(self,sock,**kwargs):return sock
ssl.create_default_context=lambda:Plain()
c=ns['DirectCDP'](ENDPOINT)
ns.update(ROOT=ROOT_PATH,TARGET_DIR=ROOT_PATH,BROWSER_STATE_PATH=ROOT_PATH+'/state.json',CURRENT_TARGET_KEY='fixture',BROWSER_STATE={'live':{}},browser_diagnostic=lambda *a:None,queue_profile_save=lambda:None,profile_save_warning=lambda:None)
class Session:
 def __getattr__(self,key):return getattr(c,key)
 def __setattr__(self,key,value):setattr(c,key,value)
 def close(self):pass
ns['CDP']=lambda url:Session()
for line in sys.stdin:
 try:
  with contextlib.redirect_stdout(io.StringIO()) as output:
   ns['execute_request'](json.loads(line),{'id':'fixture','webSocketDebuggerUrl':'local'})
  print(output.getvalue().strip(),flush=True)
 except Exception as e: print(json.dumps({'ok':False,'error':str(e)}),flush=True)
c.close()
`.replaceAll('ROOT_PATH', JSON.stringify(root)).replaceAll('CONTROLLER_PORT', String(controllerPort)).replaceAll('PORT', String(port)).replaceAll('ENDPOINT', JSON.stringify(endpoint)).replace('CONTROLLER', JSON.stringify(measuredController)).replace('LOCATOR_BASELINE',process.env.BROWSER_LOCATOR_BASELINE === '1' ? 'True' : 'False');
  const child = spawn('python3', ['-c', code], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  let pending: { resolve: (v: unknown) => void; reject: (e: Error) => void } | undefined;
  lines.on('line', line => {
    const response = JSON.parse(line); const waiter = pending; pending = undefined;
    if (response.ok) waiter?.resolve(response.value); else waiter?.reject(new Error(response.error));
  });
  child.on('exit', code => pending?.reject(new Error(`Local controller exited ${code}`)));
  let queue = Promise.resolve<unknown>(undefined);
  const timings: Array<{ operation: string; ms: number }> = [];
  const rpc = (operation: string, payload: Record<string, unknown>) => {
    const task = queue.then(async () => {
      const start = performance.now();
      try { return await new Promise((resolve, reject) => { pending = { resolve, reject }; child.stdin.write(JSON.stringify({ operation, payload }) + '\n'); }); }
      finally { timings.push({ operation, ms: performance.now() - start }); }
    });
    queue = task.catch(() => undefined); return task;
  };
  const provider = new BrowserlessCloudBrowserProvider(runId);
  // Override only remote provisioning/transport; native inputs, observations and tool policy remain production code.
  Object.assign(provider, {
    run: rpc, ensureAccount: async () => {}, warm: async () => {}, setWaitingForUser: async () => {},
    screenshot: async () => { const path = join(root, `screenshot-${crypto.randomUUID()}.png`); await rpc('screenshot', { path }); return readFile(path); },
  });
  globalThis.__decisionFeedBrowserRegistry ??= new Map();
  globalThis.__decisionFeedBrowserRegistry.set(`${userId.toLowerCase()}\u0000${runId}`, provider);
  return { provider, page, url, timings, close: async () => {
    await queue; child.stdin.end(); await browser.close();
    if(proxy){for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
    await rm(root, { recursive: true, force: true });
    globalThis.__decisionFeedBrowserRegistry?.delete(`${userId.toLowerCase()}\u0000${runId}`);
  } };
}
