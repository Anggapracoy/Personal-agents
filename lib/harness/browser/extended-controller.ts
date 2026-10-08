import { CURSOR_FRAME_POINT } from "./visual-cursor";
/** Trusted CDP primitives. No agent-authored code is evaluated except read-only
 * evaluation with Chrome's throwOnSideEffect guard and secure-page exclusion. */
export const EXTENDED_BROWSER_CONTROLLER = String.raw`
def extended_pointer_point(cdp, element):
    if element.get("mainFrame"): return {"x":element["x"],"y":element["y"]}
    contexts={c['frameId']:c for c in frame_contexts(cdp)}
    current=contexts.get(element.get('frameId'))
    point={'x':element['x'],'y':element['y']}
    seen=set()
    while current and not current.get('main'):
        if current['frameId'] in seen or len(seen)>=8: raise PreDispatchError('Frame ancestry is ambiguous')
        seen.add(current['frameId'])
        parent=contexts.get(current.get('parentFrameId'))
        if not parent: raise PreDispatchError('Parent frame is unavailable; inspect before input')
        session=parent.get('sessionId')
        owner=cdp.command('DOM.getFrameOwner',{'frameId':current['frameId']},session_id=session)
        remote=cdp.command('DOM.resolveNode',{'backendNodeId':owner['backendNodeId'],'executionContextId':parent['contextId']},session_id=session)
        object_id=remote['object']['objectId']
        try:
            result=cdp.command('Runtime.callFunctionOn',{'objectId':object_id,'functionDeclaration':${JSON.stringify(CURSOR_FRAME_POINT)},'arguments':[{'value':point}],'returnByValue':True},session_id=session)
            point=result['result']['value']
        finally:cdp.command('Runtime.releaseObject',{'objectId':object_id},session_id=session)
        current=parent
    if not current:raise PreDispatchError('Frame is detached')
    return point

def extended_query(cdp, locator):
    return recover_observation(cdp, lambda: extended_query_once(cdp, locator))

def extended_query_expression(locator, existing_only=False):
    return """(() => { %s
      __REF_COUNTER_INIT__
      const q=%s;
      const stableRefs = globalThis.__wdytElementRefs || (globalThis.__wdytElementRefs = new WeakMap());
      const text=e=>clean(e.innerText || e.textContent);
      function match(root, q) {
        let es=q.css ? deepQueryAll(q.css,root) : q.ref ? deepQueryAll('[data-decision-feed-ref="'+CSS.escape(q.ref)+'"]',root) : deepQueryAll('*',root);
        if(q.ref) es=es.filter(e=>stableRefs.get(e)===q.ref && e.getAttribute('data-decision-feed-ref')===q.ref);
        if(q.role) es=es.filter(e=>roleFor(e)===q.role);
        if(q.name!==undefined) es=es.filter(e=>q.exact===false ? nameFor(e).includes(q.name) : nameFor(e)===q.name);
        if(q.text!==undefined) es=es.filter(e=>q.exact===false ? text(e).includes(q.text) : text(e)===q.text).filter(e=>!Array.from(e.children).some(c=>q.exact===false ? text(c).includes(q.text) : text(c)===q.text));
        if(q.label!==undefined) es=es.filter(e=>Array.from(e.labels||[]).some(l=>q.exact===false ? clean(l.textContent).includes(q.label) : clean(l.textContent)===q.label) || e.getAttribute('aria-label')===q.label);
        if(q.placeholder!==undefined) es=es.filter(e=>e.getAttribute('placeholder')===q.placeholder);
        if(q.testId!==undefined) es=es.filter(e=>e.getAttribute('data-testid')===q.testId);
        if(q.visible!==undefined) es=es.filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return (r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none')===q.visible;});
        if(q.hasText!==undefined) es=es.filter(e=>text(e).includes(q.hasText));
        return es;
      }
      let roots=[document];
      for(const scope of q.scopes||[]) roots=roots.flatMap(r=>{const found=match(r,scope);return scope.index===undefined ? found : scope.index===-1 ? found.slice(-1) : found.slice(scope.index,scope.index+1);});
      let es=[...new Set(roots.flatMap(r=>match(r,q)))];
      // Resolve the DOM-name miss in this same fresh read. Previously every
      // nonmatching frame repeated the entire DOM traversal in another RPC.
      const nativeCandidates=es.length===0 && Boolean(q.role) && typeof q.name==='string';
      if(nativeCandidates){const candidates={...q};delete candidates.name;es=[...new Set(roots.flatMap(r=>match(r,candidates)))];}
      if (__EXISTING_ONLY__ && es.slice(0,200).some(e=>!stableRefs.get(e) || e.getAttribute('data-decision-feed-ref')!==stableRefs.get(e))) return {needsRefs:true};
      const matches=es.slice(0,200).map(e=>{
        // Identity belongs to the actual node, never a cloned DOM attribute.
        let ref=stableRefs.get(e);
        if(!ref){ref='e'+(++globalThis.__wdytRefCounter);stableRefs.set(e,ref);}
        if(e.getAttribute('data-decision-feed-ref')!==ref)e.setAttribute('data-decision-feed-ref',ref);
        const secure=e.matches('input[type=password],[data-decision-feed-secret=true]') || Boolean(e.querySelector('[data-decision-feed-secret=true],input[type=password]'));
        const r=e.getBoundingClientRect(),s=getComputedStyle(e);
        const containers=[];
        for(let parent=composedParent(e);parent&&containers.length<4;parent=composedParent(parent)){
          const role=roleFor(parent);
          if(['dialog','alertdialog','form','region','group','main','navigation'].includes(role))containers.push({role,name:nameFor(parent).slice(0,160),ref:stableRefs.get(parent)||null});
        }
        return {ref,containers,rect:{x:r.x,y:r.y,width:r.width,height:r.height},role:roleFor(e),name:nameFor(e),text:secure?'[secure]':text(e).slice(0,12000),visible:r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none',enabled:!e.matches(':disabled')&&!e.closest('[aria-disabled=true]'),checked:e.matches(':checked'),attributes:Object.fromEntries([...['href','src','alt','title','type','placeholder','aria-label','role'],...(e.tagName==='OPTION' ? ['value'] : [])].map(k=>[k,e.getAttribute(k)]))};
      });
      return {matches,nativeCandidates,nextRef:globalThis.__wdytRefCounter || 0};
    })()""".replace("__EXISTING_ONLY__", "true" if existing_only else "false") % (DOM_HELPERS, json.dumps(locator))

def extended_query_once(cdp, locator):
    rows = []
    # An exact observed ref has one known frame. Re-read the actual node there;
    # a missing/destroyed context falls back to complete fresh discovery.
    exact_ref = locator.get('ref')
    route = cdp.reference_routes(exact_ref) if isinstance(exact_ref,str) and set(locator).issubset({'ref','frame','index'}) and hasattr(cdp,'reference_routes') else None
    if route and (not locator.get('frame') or locator['frame'] in (route.get('frameId'),route.get('url'))):
        try:
            value = evaluate_context(cdp, extended_query_expression(locator).replace('__REF_COUNTER_INIT__','',1), route)
            matches = value.get('matches', [])
            if len(matches) == 1:
                for row in matches:
                    row['frameId'] = route.get('frameId'); row['mainFrame'] = route.get('main',False)
                return matches if 'index' not in locator else matches[locator['index']:locator['index']+1] if locator['index'] >= 0 else matches[locator['index']:]
        except Exception:
            pass
    contexts = frame_contexts(cdp, refresh=True)
    # Hidden elements also receive refs. Preserve the isolated-world high-water
    # mark, rather than resetting it from visible accessibility nodes.
    # A ref lookup can only return nodes already in the identity WeakMap. It
    # cannot allocate a ref, so avoid synchronizing every frame's counter.
    existing_ref=bool(locator.get('ref'))
    next_ref=0
    expression = extended_query_expression(locator)
    simple_ref=existing_ref and isinstance(locator['ref'],str) and locator['ref'].startswith('e') and locator['ref'][1:].isascii() and locator['ref'][1:].isdigit() and set(locator).issubset({'ref','frame','index'}) and hasattr(cdp,'reference_query')
    selected=[c for c in contexts if not locator.get('frame') or locator['frame'] in (c.get('frameId'),c.get('url'))]
    batched=[]
    fast_rows=None
    if not existing_ref and selected and hasattr(cdp,'existing_locator_query'):
        replies=[]
        for start in range(0,len(selected),64):
            replies.extend(cdp.existing_locator_query(selected[start:start+64],locator))
        for reply in replies:
            if 'error' in reply: raise RuntimeError(reply['error'])
        if all(isinstance(reply.get('value'),dict) and not reply['value'].get('needsRefs') for reply in replies):
            fast_rows=[reply['value'] for reply in replies]
    if not existing_ref and fast_rows is None:
        next_ref=frame_reference_counter(cdp,contexts)
    if simple_ref:
        for start in range(0,len(selected),64):
            batched.extend(cdp.reference_query(selected[start:start+64],locator['ref']))
    for position,context in enumerate(selected):
        init='' if existing_ref else 'globalThis.__wdytRefCounter='+str(next_ref)+';'
        if fast_rows is not None:
            observed=fast_rows[position]
        elif simple_ref:
            reply=batched[position]
            if 'error' in reply: raise RuntimeError(reply['error'])
            observed=reply['value']
        else:
            observed=evaluate_context(cdp, expression.replace('__REF_COUNTER_INIT__',init,1), context)
        next_ref=max(next_ref,int(observed['nextRef']))
        matches=observed['matches']
        if observed.get('nativeCandidates'):
            # Chromium still owns native accessible names. Preserve ambiguity,
            # scopes and exact/substr matching; only the duplicate DOM read goes.
            matches=[]
            if observed['matches']:
                _,identities=accessibility_identity(cdp,context)
                for row in observed['matches']:
                    identity=identities.get(row['ref'],{})
                    name=identity.get('name','')
                    name_matches=locator['name'] in name if locator.get('exact') is False else locator['name']==name
                    if identity.get('role')==locator['role'] and name_matches:
                        row.update(identity)
                        matches.append(row)
        for row in matches:
            row["frameId"]=context.get("frameId")
            row["mainFrame"]=context.get("main",False)
        rows.extend(matches)
        if matches and hasattr(cdp,'reference_routes'):
            cdp.reference_routes(updates=[{'context':context,'refs':[row['ref'] for row in matches]}])
    if contexts and not existing_ref and fast_rows is None: evaluate_context(cdp,'globalThis.__wdytRefCounter='+str(next_ref),contexts[0])
    if 'index' in locator:
        index=locator['index']
        rows=rows[index:index+1] if index>=0 else rows[index:]
    return rows

def extended_poll_query(cdp, locator, poll):
    # Poll fresh locator state on this controller connection. Never serialize
    # the full page or dispatch input just to wait for a read condition.
    state = poll['state']
    if state not in ('attached', 'visible', 'hidden', 'enabled'):
        raise RuntimeError('Invalid locator wait state')
    timeout = float(poll['timeoutMs'])
    if not 0 <= timeout <= 20000:
        raise RuntimeError('Invalid locator wait timeout')
    deadline = time.monotonic() + timeout / 1000
    while True:
        rows = extended_query(cdp, locator)
        matched = (bool(rows) if state == 'attached' else
                   all(not row.get('visible') for row in rows) if state == 'hidden' else
                   len(rows) == 1 and bool(rows[0].get('enabled' if state == 'enabled' else 'visible')))
        if state == 'hidden' and getattr(cdp, 'frame_context_warnings', []):
            matched = False  # Missing frames are not evidence of disappearance.
        if matched:
            return rows
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            if state == 'attached': return rows
            raise RuntimeError('Locator wait timed out')
        time.sleep(min(0.15, remaining))

def extended_secure_page(cdp):
    return any(evaluate_context(cdp, "Boolean(deepQuery('input[type=password],[data-decision-feed-secret=true]'))", context) for context in frame_contexts(cdp))

def extended_browser(cdp, target, payload):
    action=payload['action']
    if action=='query': return {'matches':extended_poll_query(cdp,payload['locator'],payload['poll']) if payload.get('poll') else extended_query(cdp,payload['locator'])}
    if action=='evaluate':
        if extended_secure_page(cdp): raise RuntimeError('Read-only evaluation is unavailable on a page containing secure fields. Use the redacted snapshot.')
        result=cdp.command('Runtime.evaluate',{'expression':payload['expression'],'returnByValue':True,'throwOnSideEffect':True,'timeout':1000})
        if result.get('exceptionDetails'): raise RuntimeError('Chrome could not verify this expression is side-effect-free, or evaluation failed. Use locator read methods; for geometry use boundingBox(), not DOMRect.toJSON(). Do not retry mutations through evaluation.')
        value=result.get('result',{}).get('value')
        if len(json.dumps(value))>100000: raise RuntimeError('Evaluation result is too large; return a smaller selection')
        return {'value':value}
    if action in ('forward','reload'):
        if action=='reload': cdp.command('Page.reload')
        else:
            history=cdp.command('Page.getNavigationHistory')
            index=history['currentIndex']+1
            if index<len(history['entries']): cdp.command('Page.navigateToHistoryEntry',{'entryId':history['entries'][index]['id']})
        time.sleep(.2)
        ready(cdp)
        return snapshot(cdp)
    if action.startswith('tabs_'):
        key='tabs:'+CURRENT_TARGET_KEY
        owned=BROWSER_STATE.setdefault(key,[])
        if target['id'] not in owned: owned.append(target['id'])
        targets=[t for t in json_request('/json/list') if t.get('type')=='page']
        # Popups belong only to their opener's task, never to arbitrary account tabs.
        infos=cdp.command('Target.getTargets').get('targetInfos',[])
        for _ in range(8):
            for t in infos:
                if t.get('openerId') in owned and t.get('type')=='page' and t['targetId'] not in owned: owned.append(t['targetId'])
        created_id=None
        if action=='tabs_new':
            new=json_request('/json/new?'+urllib.parse.quote('about:blank',safe=''),'PUT')
            owned.append(new['id']); targets.append(new); created_id=new['id']
        if action in ('tabs_select','tabs_close'):
            identity=payload['id']
            if identity not in owned: raise RuntimeError('Tab does not belong to this task')
            if action=='tabs_select':
                if not any(t['id']==identity for t in targets): raise RuntimeError('Tab is closed')
                if identity != target['id']:
                    prior=BROWSER_STATE.setdefault('live',{}).pop(CURRENT_TARGET_KEY,None)
                    if prior:
                        try: cdp.command('Browserless.closeLiveURL',{'liveURLId':prior['id']})
                        except Exception: pass
                with open(target_path(CURRENT_TARGET_KEY),'w') as h: h.write(identity)
            else:
                if identity==target['id'] and len([t for t in targets if t['id'] in owned])<2: raise RuntimeError('Open another tab before closing the last tab')
                if identity==target['id']:
                    prior=BROWSER_STATE.setdefault('live',{}).pop(CURRENT_TARGET_KEY,None)
                    if prior:
                        try: cdp.command('Browserless.closeLiveURL',{'liveURLId':prior['id']})
                        except Exception: pass
                json_request('/json/close/'+urllib.parse.quote(identity,safe=''))
                child_path=target_path(CURRENT_TARGET_KEY)+'.child-'+identity+'.target'
                if os.path.exists(child_path): os.unlink(child_path)
                owned.remove(identity); targets=[t for t in targets if t['id']!=identity]
                if identity==target['id']:
                    with open(target_path(CURRENT_TARGET_KEY),'w') as h: h.write(next(t['id'] for t in targets if t['id'] in owned))
        for identity in owned:
            with open(target_path(CURRENT_TARGET_KEY)+'.child-'+identity+'.target','w') as h: h.write(identity)
        private_json(BROWSER_STATE_PATH,BROWSER_STATE)
        return {'createdId':created_id,'tabs':[{'id':t['id'],'title':t.get('title',''),'url':t.get('url',''),'selected':t['id']==read_target_id(target_path(CURRENT_TARGET_KEY))} for t in targets if t['id'] in owned]}
    if action=='dialog':
        cdp.command('Page.handleJavaScriptDialog',{'accept':payload['accept'],'promptText':payload.get('text','')})
        return snapshot(cdp)
    if action=='logs':
        if not (hasattr(cdp,'observations') and cdp.observations().get('dialog')): cdp.command('Log.enable')
        cdp.pump_events(.05)
        return cdp.observations() if hasattr(cdp,'observations') else {'logs':[]}
    if action=='clipboard_write':
        BROWSER_STATE['clipboard:'+CURRENT_TARGET_KEY]=payload['text']; private_json(BROWSER_STATE_PATH,BROWSER_STATE)
        return {'written':True}
    if action=='clipboard_read': return {'text':BROWSER_STATE.get('clipboard:'+CURRENT_TARGET_KEY,'')}
    if action=='upload':
        element=describe(cdp,payload['ref'])
        if element.get('type')!='file': raise RuntimeError('Select an input[type=file] upload control')
        files=payload['files']
        if sum(len(base64.b64decode(f['base64'],validate=True)) for f in files)>10*1024*1024: raise RuntimeError('Upload batch exceeds 10 MB')
        # Browserless and the controller have different filesystems. Transfer
        # file payloads to the actual browser, never send E2B-local file paths.
        expression="""(() => {const e=deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');const files=%s;
          if(!e || e.type!=='file' || e.disabled || (!e.multiple && files.length>1))throw Error('Upload control unavailable or does not accept multiple files');
          const transfer=new DataTransfer();for(const f of files){const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],f.name,{type:f.mimeType||'application/octet-stream'}));}
          e.files=transfer.files;e.dispatchEvent(new Event('input',{bubbles:true,composed:true}));e.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return Array.from(e.files,f=>({name:f.name,size:f.size}));})()""" % (json.dumps(payload['ref']),json.dumps(files))
        retained=evaluate(cdp,expression,element['contextId'],element.get('sessionId'))
        if len(retained or [])!=len(files):raise RuntimeError('Upload selection was not retained')
        return snapshot(cdp)
    if action=='download':
        # Fetch through the browser's existing session. URL is validated server-side.
        result=cdp.command('Network.loadNetworkResource',{'frameId':cdp.command('Page.getFrameTree')['frameTree']['frame']['id'],'url':payload['url'],'options':{'disableCache':False,'includeCredentials':True}})['resource']
        if not result.get('success') or not result.get('stream'): raise RuntimeError('Browser download failed')
        data=bytearray();stream=result['stream']
        try:
            while True:
                chunk=cdp.command('IO.read',{'handle':stream,'size':65536})
                data.extend(base64.b64decode(chunk['data']) if chunk.get('base64Encoded') else chunk['data'].encode())
                if len(data)>10*1024*1024: raise RuntimeError('Download exceeds 10 MB')
                if chunk.get('eof'):break
        finally:cdp.command('IO.close',{'handle':stream})
        return {'base64':base64.b64encode(data).decode(),'mimeType':result.get('headers',{}).get('content-type','application/octet-stream')}
    raise RuntimeError('Unknown extended browser action')
`;
