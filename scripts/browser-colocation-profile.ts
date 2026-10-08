/** Diagnostic only. Never installed by production code. Public read-only runs,
 * no account profiles/credentials/viewer/CAPTCHA service. API guards unchanged. */
import {Sandbox} from 'e2b';
const localRuntime=String.raw`
# Isolated colocation experiment. Local CDP is never enabled in production.
_remote_connect_browser=connect_browser
def browserless_url(url):
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!='ws' or parsed.hostname!='127.0.0.1' or not parsed.port or parsed.port<1024:
        raise RuntimeError('Only diagnostic loopback CDP allowed')
    return url
def browserless_api(*args,**kwargs):
    raise RuntimeError('Profiles, CAPTCHA service and viewer are outside this isolated diagnostic')
def queue_profile_save(): pass
def profile_save_warning(): return None
def flush_profile_before_close(): pass
def connect_browser(request):
    global BROWSER_STATE,BROWSER_CONNECTION
    if os.path.exists(BROWSER_STATE_PATH):
        return _remote_connect_browser(request)
    if request.get('operation') not in ('navigate','import_cookies'):
        raise RuntimeError('Isolated browser is not running; input is never replayed')
    prewarmed='/tmp/dash-prewarmed-chromium'
    claim=ROOT+'/diagnostic-prewarmed-claimed'
    use_prewarmed=os.path.exists(prewarmed+'/DevToolsActivePort') and not os.path.exists(claim)
    profile=prewarmed if use_prewarmed else ROOT+'/diagnostic-chromium'
    os.makedirs(profile,mode=0o700,exist_ok=True)
    if use_prewarmed:
        private_json(claim,{'claimed':True})
    else:
        subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-dev-shm-usage',
          '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,
          '--no-first-run','--no-default-browser-check','about:blank'],stdin=subprocess.DEVNULL,
          stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        try:
            lines=open(profile+'/DevToolsActivePort').read().splitlines()
            endpoint='ws://127.0.0.1:'+lines[0]+lines[1]
            browserless_url(endpoint)
            BROWSER_STATE={'ws':endpoint,'expiresAt':time.time()+600,'generation':os.urandom(16).hex(),'live':{},'profileExists':False}
            BROWSER_CONNECTION=CDP(endpoint)
            BROWSER_CONNECTION.command('Target.getTargets')
            break
        except Exception as error:
            last_error=type(error).__name__+': '+str(error)[:200]
            time.sleep(.05)
    else: raise RuntimeError('Isolated Chromium failed to start: '+last_error)
    private_json(BROWSER_STATE_PATH,BROWSER_STATE)
def finish_browser():
    if BROWSER_CONNECTION: BROWSER_CONNECTION.close()
`;
export function installColocationProfile(prototype:any) {
 if(!process.env.COMPARISON_DATABASE_URL || new URL(process.env.COMPARISON_DATABASE_URL).hostname!=='127.0.0.1') throw new Error('Only isolated diagnostic storage allowed');
 const initialize=prototype.initializeAccount;
 prototype.initializeAccount=function(...args:any[]){
  if(!this.userId?.startsWith('live-speed-')||!this.userId.endsWith('@example.invalid'))throw new Error('Real users cannot enter this diagnostic');
  return initialize.apply(this,args);
 };
 const create=Sandbox.create.bind(Sandbox) as any;
 (Sandbox as any).create=async(...args:any[])=>{
  const options=args[0];
  if(options?.metadata?.service!=='dash-browser-controller')return create(...args);
  if(!process.env.E2B_TEMPLATE_ID)throw new Error('Existing Chromium template required');
  const sandbox=await create(process.env.BROWSER_COLOCATION_TEMPLATE_ID || process.env.E2B_TEMPLATE_ID,{...options,network:{...options.network,allowPublicTraffic:false}});
  const write=sandbox.files.write.bind(sandbox.files);
  sandbox.files.write=(path:string,contents:any,...rest:any[])=>{
   if(typeof contents==='string'&&contents.includes('def execute_request(request, target):')){
    contents=contents.replace('self.sock = ssl.create_default_context().wrap_socket(socket.create_connection((url.hostname, 443), timeout=10), server_hostname=url.hostname)',
      'self.sock = socket.create_connection((url.hostname, url.port), timeout=10)')
      .replace('\n# Durations only:',localRuntime+'\n# Durations only:');
   }
   return write(path,contents,...rest);
  };
  const command=sandbox.commands.run.bind(sandbox.commands);
  sandbox.commands.run=(cmd:string,options:any={})=>{
   const envs={...options.envs};delete envs.BROWSERLESS_API_TOKEN;
   return command(cmd,{...options,envs});
  };
  return sandbox;
 };
}
