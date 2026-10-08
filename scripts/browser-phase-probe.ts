/** Disposable Browserless/E2B timing probe. No user profile or submissions. */
import { BrowserlessCloudBrowserProvider, createCloudBrowserAccountState } from '../lib/harness/browser/cloud';
const account=createCloudBrowserAccountState();
const key='latency-probe-'+crypto.randomUUID();
const browser=new BrowserlessCloudBrowserProvider(key,account,key);
// Instrument only this disposable provider's uploaded controller. No production toggle.
const internal=browser as unknown as {attachProvider:(id:string)=>Promise<void>};
const attach=internal.attachProvider.bind(browser);
internal.attachProvider=async id=>{
 const files=account.sandbox!.files;
 const write=files.write.bind(files);
 files.write=(async(path:unknown,contents:unknown,...rest:unknown[])=>{
  if(typeof contents==='string'&&contents.includes('def execute_request(')){
   if(process.env.BROWSER_PROBE_TRANSPORT==='1') {
    // Same-process monotonic clocks isolate IPC queueing from the Chrome wait.
    // Only durations and protocol method names leave this disposable controller.
    contents=String(contents)
     .replace('sent = False\n    try:', 'sent = False\n    queued_at = time.monotonic()\n    try:')
     .replace('dict(message, protocol=CDP_POOL_PROTOCOL, **cdp_pool_metadata())', 'dict(message, queuedAt=queued_at, protocol=CDP_POOL_PROTOCOL, **cdp_pool_metadata())')
     .replace('result = json.loads(line)\n            if not result.get("ok"):', 'result = json.loads(line)\n            timing = result.get("probeTiming")\n            if timing and time.monotonic()-queued_at > 0.5:\n                print("TRANSPORT_TIME " + json.dumps({"operation":message.get("operation"),"method":message.get("method"),"queueMs":round((timing[0]-queued_at)*1000),"chromeMs":round((timing[1]-timing[0])*1000),"returnMs":round((time.monotonic()-timing[1])*1000)}),flush=True)\n            if not result.get("ok"):')
     .replace('message = json.loads(line)\n                        if message.get("protocol")', 'message = json.loads(line)\n                        probe_started = time.monotonic()\n                        if message.get("protocol")')
     .replace('response = {"ok": True, "value": value}', 'response = {"ok": True, "value": value, "probeTiming":[probe_started,time.monotonic()]}');
   }
   if(process.env.BROWSER_PROBE_STANDARD_CHROME==='1') contents=String(contents).replace('/stealth/bql?', '/chrome/bql?');
   if(process.env.BROWSER_PROBE_NATIVE_FILL==='1') contents=String(contents).replace('replace_field_text(cdp, payload["ref"], payload["text"], require_focused=operation == "secure_type")', 'replace_field_text(cdp, payload["ref"], payload["text"], strategy="keys" if operation == "secure_type" else "insert", require_focused=operation == "secure_type")');
   if(process.env.BROWSER_PROBE_KEY_WINDOW==='64') contents=String(contents).replace('range(0, len(text), 16)', 'range(0, len(text), 64)').replace('text[start:start + 16]', 'text[start:start + 64]');
   if(process.env.BROWSER_PROBE_LEGACY_TYPING==='1') contents=String(contents).replaceAll("hasattr(cdp, 'type_keys')", "False");
   if(process.env.BROWSER_PROBE_LEGACY_REFS==='1') contents=String(contents).replace("if (element.getAttribute('data-decision-feed-ref') !== ref) element.setAttribute('data-decision-feed-ref', ref);", "element.setAttribute('data-decision-feed-ref', ref);").replace('const ref = stableRefs.get(element);', "const ref = stableRefs.get(element); element.setAttribute('data-decision-feed-ref', ref);");
   const instrumentation=String.raw`
_PHASES = {}
def _timed_phase(name, original):
    def measured(*args, **kwargs):
        at = time.monotonic()
        try: return original(*args, **kwargs)
        finally:
            row = _PHASES.setdefault(name, {"calls":0,"ms":0})
            row["calls"] += 1
            row["ms"] += round((time.monotonic()-at)*1000)
    return measured
_command = CDP.command
def _timed_command(self, method, *args, **kwargs):
    label='cdp.' + method
    if method == 'Input.dispatchMouseEvent': label += '.' + str((args[0] if args else kwargs.get('params', {})).get('type'))
    if method == 'Input.dispatchMouseEvent':
        print('MOUSE_START ' + json.dumps({'type':label,'at':time.time()}),flush=True)
    try:
        result = _timed_phase(label, _command)(self, method, *args, **kwargs)
        if method == 'Page.getFrameTree':
            print('FRAME_ROUTE '+json.dumps({'frames':[{'id':f['id'],'parent':f.get('parentId')} for f in flatten_frames(result.get('frameTree',{}))]}),flush=True)
        if method == 'Target.getTargets':
            print('FRAME_ROUTE '+json.dumps({'targets':[{k:i.get(k) for k in ('targetId','type','parentId','parentFrameId')} for i in result.get('targetInfos',[])]}),flush=True)
        return result
    except Exception as error:
        print('FRAME_ROUTE '+json.dumps({'method':method,'error':str(error)[:180]}),flush=True)
        raise
CDP.command = _timed_command
for _name in ("connect_browser", "choose_target", "ready", "snapshot", "frame_contexts", "accessibility_identity", "browser_diagnostic", "visual_cursor", "finish_browser", "describe", "wait_for_input_ready", "pointer_click", "observe_click_outcome", "recover_missing_hosted_fields"):
    globals()[_name] = _timed_phase(_name, globals()[_name])
_pointer = pointer_click
def pointer_click(cdp, *args, **kwargs):
    cdp.command('Profiler.enable')
    cdp.command('Profiler.start')
    cdp.command('Performance.enable')
    before = {x['name']:x['value'] for x in cdp.command('Performance.getMetrics')['metrics']}
    started=time.monotonic()
    try: return _pointer(cdp,*args,**kwargs)
    finally:
        after={x['name']:x['value'] for x in cdp.command('Performance.getMetrics')['metrics']}
        profile=cdp.command('Profiler.stop')['profile']
        nodes={n['id']:n['callFrame'] for n in profile['nodes']}
        totals={}
        for sample,delta in zip(profile.get('samples',[]),profile.get('timeDeltas',[])):
            frame=nodes.get(sample,{})
            label=(frame.get('functionName',''),urllib.parse.urlparse(frame.get('url','')).path[:160],frame.get('lineNumber'))
            totals[label]=totals.get(label,0)+delta
        print('CPU_PROFILE ' + json.dumps(sorted([{'function':k[0],'path':k[1],'line':k[2],'ms':round(v/1000)} for k,v in totals.items()],key=lambda v:-v['ms'])[:12]),flush=True)

        print('DASH_DIAGNOSTIC ' + json.dumps({'stage':'phase_probe','phases':{'cpu.'+k:{'ms':round(1000*(after[k]-v))} for k,v in before.items() if k in ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration']}}),flush=True)
_evaluate_context = evaluate_context
def evaluate_context(cdp, expression, context):
    label = 'snapshot' if 'const observationRoot' in expression else 'ref_counter' if expression == 'globalThis.__wdytRefCounter || 0' else 'other'
    if label == 'snapshot':
        wrapped = "(() => { const started = performance.now(); const value = (" + expression + "); return {value, elapsed:performance.now()-started}; })()"
        started=time.monotonic()
        value=_evaluate_context(cdp,wrapped,context)
        print('EVALUATE_TIME '+json.dumps({'label':label,'main':context.get('main'),'wallMs':round((time.monotonic()-started)*1000),'pageMs':value['elapsed']}),flush=True)
        return value['value']
    return _evaluate_context(cdp,expression,context)
_original_main = main
def main():
    try: return _original_main()
    finally: print("DASH_DIAGNOSTIC " + json.dumps({"stage":"phase_probe","phases":_PHASES}), flush=True)
`;
   contents=String(contents).replace('if __name__ == "__main__":',instrumentation+'\nif __name__ == "__main__":');
  }
  return (write as (...args:unknown[])=>Promise<unknown>)(path,contents,...rest);
 }) as typeof files.write;
 const run=account.sandbox!.commands.run.bind(account.sandbox!.commands);
 account.sandbox!.commands.run=(async(...args:unknown[])=>{
  let result:{stdout:string};
  try { result=await (run as (...args:unknown[])=>Promise<{stdout:string}>)(...args); }
  catch(error){
   const output=String((error as {stdout?:string}).stdout||'');
   for(const line of output.split('\n'))if(line.startsWith('DASH_DIAGNOSTIC ')||line.startsWith('FRAME_ROUTE ')||line.startsWith('EVALUATE_TIME ')||line.startsWith('TRANSPORT_TIME '))console.log(line);
   throw error;
  }
  for(const line of result.stdout.split('\n'))if(line.includes('"stage": "phase_probe"')||line.startsWith('CPU_PROFILE ')||line.startsWith('FRAME_ROUTE ')||line.startsWith('EVALUATE_TIME ')||line.startsWith('TRANSPORT_TIME '))console.log(line);
  return result;
 }) as typeof run;
 try{await attach(id);}finally{files.write=write;}
};
try {
 const start=performance.now();const initial=await browser.open(key,process.env.BROWSER_PROBE_URL || 'https://example.com');console.log('CONTROLS',JSON.stringify(initial.elements.map(e=>({ref:e.ref,role:e.role,name:e.name})).slice(0,100)));
 console.log(JSON.stringify({phase:'startup',elapsedMs:performance.now()-start}));
 if(process.env.BROWSER_PROBE_STANDARD_CHROME==='1' && /just a moment|verify you are human|captcha|checking your browser/i.test(initial.formatted)) throw Error('Comparison stopped: browser challenge');
 const sandbox=account.sandbox!;
 let spans:Array<{name:string;ms:number}>=[];
 function track(target:object,name:string) {
  const owner=target as Record<string,(...args:unknown[])=>Promise<unknown>>;
  const original=owner[name].bind(target);
  owner[name]=async(...args)=>{const at=performance.now();try{return await original(...args);}finally{spans.push({name,ms:performance.now()-at});}};
 }
 track(sandbox,'setTimeout');track(sandbox.files,'write');track(sandbox.files,'remove');track(sandbox.commands,'run');
 for(let i=0;i<1;i++){
  spans=[];const start=performance.now();const page=await browser.snapshot();
  if(!page.elements)throw Error('Missing controls');
  console.log(JSON.stringify({phase:'snapshot',iteration:i,elapsedMs:performance.now()-start,spans}));
 }
 if(process.env.BROWSER_PROBE_URL){
 if(process.env.BROWSER_PROBE_TYPING==='1'){
 const before=await browser.snapshot();const field=before.elements.find(e=>e.role==='textbox'&&e.name.includes('Search in'));
 if(!field)throw Error('Search field absent');
 const content='Chicken '.repeat(17)+'food';
 const start=performance.now();const typed=await browser.type(field.ref,content);console.log('STORE_TYPING',JSON.stringify({ms:performance.now()-start,characters:content.length,retained:typed.elements.some(e=>e.value===content),snapshotChars:typed.formatted.length,warnings:typed.warnings??[]}));
 } else {
 const before=await browser.snapshot();const entry=before.elements.find(e=>e.role==='button'&&e.name==='Store info');
 if(!entry){console.log('MISSING_TARGET',JSON.stringify(before.elements.map(e=>({ref:e.ref,role:e.role,name:e.name}))));throw Error('Store info absent');}
 const at=performance.now();const after=await browser.click(entry.ref);console.log('CLICK',JSON.stringify({ms:performance.now()-at,controls:after.elements.map(e=>({ref:e.ref,role:e.role,name:e.name})).filter(e=>e.role==='button'||e.role==='textbox')}));
 let state=after;
 for(let i=0;i<0;i++){
 const name=i%2===0?'Close':'Store info';const target=state.elements.find(e=>e.role==='button'&&e.name===name);if(!target)throw Error('Missing '+name);
 const start=performance.now();state=await browser.click(target.ref);console.log('REPEAT_CLICK',JSON.stringify({name,ms:performance.now()-start,modal:state.activeModalCount}));
 }

 }
 }
 if(process.env.BROWSER_PROBE_SKIP_FORM!=='1'){
 const form=await browser.open(key,'https://www.selenium.dev/selenium/web/web-form.html');
 const checkbox=form.elements.find(e=>e.name==='Default checkbox');if(!checkbox)throw Error('Checkbox absent');
 const at=performance.now();await browser.click(checkbox.ref);console.log('FORM_CLICK',performance.now()-at);
 }
}finally{await browser.destroy();console.log("CLEANUP_COMPLETE");}

console.log("CLEANUP_COMPLETE");process.exit(0);
