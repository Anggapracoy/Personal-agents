/** Diagnostic-only instrumentation. No command arguments, URLs, headers or secrets are logged. */
export const ONE_SHOT_INSTRUMENTATION = String.raw`
if not (len(sys.argv) == 3 and sys.argv[1] in ('--cdp-pool', '--profile-worker')):
    import atexit
    _shot_rows=[]
    _shot_phases=[]
    _shot_command=CDP.command
    _shot_reads=CDP.read_commands
    _shot_execute=execute_request
    _shot_probe=False
    def _shot_send(self, method, params=None, **kwargs):
        started=time.perf_counter()
        row={'method':method,'probe':_shot_probe,'startedAtMs':time.time()*1000}
        arguments=dict(params or {})
        wrapped=method=='Runtime.evaluate' and arguments.get('returnByValue') is True and arguments.get('awaitPromise') is True and not arguments.get('throwOnSideEffect')
        if wrapped:
            expression=arguments['expression']
            arguments['expression']='(async()=>{const started=performance.now();const value=await ('+expression+');return {__dashTimedValue:true,rendererMs:performance.now()-started,value};})()'
        try:
            result=_shot_command(self,method,arguments,**kwargs)
            row['responseBytes']=len(json.dumps(result,separators=(',',':')).encode('utf8'))
            if wrapped and isinstance(result.get('result',{}).get('value'),dict):
                envelope=result['result']['value']
                if envelope.get('__dashTimedValue') is True:
                    row['rendererMs']=envelope['rendererMs']
                    value=envelope.get('value')
                    result={**result,'result':({'type':'undefined'} if 'value' not in envelope else {'type':'object' if value is None or isinstance(value,(dict,list)) else 'boolean' if isinstance(value,bool) else 'number' if isinstance(value,(int,float)) else 'string','value':value})}
            if result.get('exceptionDetails'):row['javascriptException']=True
            return result
        except Exception as error:
            row['errorType']=type(error).__name__
            raise
        finally:
            row['elapsedMs']=(time.perf_counter()-started)*1000
            _shot_rows.append(row)
    CDP.command=_shot_send
    def _shot_batch(self,commands,**kwargs):
        started=time.perf_counter()
        row={'method':'read_commands','methods':[c['method'] for c in commands],'probe':False,'startedAtMs':time.time()*1000}
        try:
            value=_shot_reads(self,commands,**kwargs)
            row['responseBytes']=len(json.dumps(value,separators=(',',':')).encode('utf8'))
            return value
        except Exception as error:
            row['errorType']=type(error).__name__
            raise
        finally:
            row['elapsedMs']=(time.perf_counter()-started)*1000
            _shot_rows.append(row)
    CDP.read_commands=_shot_batch
    def _shot_metrics(cdp):
        return {r['name']:r['value'] for r in cdp.command('Performance.getMetrics',timeout=2).get('metrics',[]) if r['name'] in ('Timestamp','TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','JSHeapUsedSize','Nodes','Documents','Frames')}
    def _shot_run(request,target):
        global _shot_probe
        cdp=CDP(target['webSocketDebuggerUrl'])
        phase={'operation':request.get('operation')}
        before={}
        try:
            _shot_probe=True
            cdp.command('Performance.enable',timeout=2)
            cdp.command('Browser.getVersion',timeout=2)
            if request.get('payload',{}).get('action') != 'dialog':
                cdp.command('Runtime.evaluate',{'expression':'1','returnByValue':True},timeout=2)
            before=_shot_metrics(cdp)
        except Exception as error:phase['beforeProbeError']=type(error).__name__
        finally:_shot_probe=False
        started=time.perf_counter();cpu=time.process_time()
        try:return _shot_execute(request,target)
        finally:
            phase['wallMs']=(time.perf_counter()-started)*1000
            phase['controllerCpuMs']=(time.process_time()-cpu)*1000
            try:
                _shot_probe=True
                after=_shot_metrics(cdp)
                phase['chromeBefore']=before;phase['chromeAfter']=after
                if request.get('operation')=='screenshot':
                    nav=cdp.command('Runtime.evaluate',{'expression':"({navigation:performance.getEntriesByType('navigation').map(n=>({duration:n.duration,requestStart:n.requestStart,responseStart:n.responseStart,responseEnd:n.responseEnd,domInteractive:n.domInteractive,domContentLoadedEventEnd:n.domContentLoadedEventEnd,loadEventEnd:n.loadEventEnd})),resourceCount:performance.getEntriesByType('resource').length})",'returnByValue':True},timeout=2)
                    phase['pageTiming']=nav.get('result',{}).get('value')
            except Exception as error:phase['afterProbeError']=type(error).__name__
            finally:_shot_probe=False
            _shot_phases.append(phase)
    execute_request=_shot_run
    atexit.register(lambda:sys.stderr.write('DASH_ONESHOT '+json.dumps({'commands':_shot_rows,'phases':_shot_phases},separators=(',',':'))+'\n'))
`;
