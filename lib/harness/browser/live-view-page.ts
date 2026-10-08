import { takeoverInputScript } from './takeover-input-script';
import { randomUUID } from 'node:crypto';

/** Shared stream UI; input is attached only for explicit takeover. */
export function liveViewPage(runId: string, control = false) {
  const nonce = randomUUID();
  const endpoint = `/api/runs/${encodeURIComponent(runId)}/browser?stream=1${control ? "&control=1" : ""}`;
  const script = String.raw`
(() => {
 const endpoint=__ENDPOINT__, control=__CONTROL__, image=document.querySelector('canvas'), status=document.querySelector('[role=status]');
 let socket=null, stopped=false, reconnecting=false, pending=null, loading=false, retries=0, timer=null, releaseInput=()=>{}, restoreInput=()=>{}, handleStreamEvent=()=>{}, inputReady=false, needsReopen=false;
 function message(text){status.textContent=text;status.hidden=!text;}
 function stop(text){releaseInput();inputReady=false;stopped=true;clearTimeout(timer);if(socket){socket.onclose=socket.onerror=socket.onmessage=null;socket.close();}message(text);}
 async function frame(blob){
  pending=blob;if(loading)return;loading=true;
  try{while(pending&&!stopped){
   const blob=pending;pending=null;const url=URL.createObjectURL(blob);
   try{
    const decoded=new Image();await new Promise((resolve,reject)=>{decoded.onload=resolve;decoded.onerror=reject;decoded.src=url;});
    if(stopped)break;
    if(image.width!==decoded.naturalWidth||image.height!==decoded.naturalHeight){image.width=decoded.naturalWidth;image.height=decoded.naturalHeight;}
    image.getContext('2d').drawImage(decoded,0,0);image.dataset.ready='true';message('');retries=0;
   }finally{URL.revokeObjectURL(url);}
  }}catch{/* Preserve the last decoded frame. */}finally{loading=false;}
 }
 async function connect(refresh=false){
  if(stopped||reconnecting)return;
  reconnecting=true;
  try{
   const response=await fetch(endpoint+(refresh?'&refresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(response.status===401){stop('Sign in again to view this browser.');return;}
   const info=await response.json();if(stopped)return;
   if(control&&response.status===409){stop('Browser takeover is no longer waiting. Return to the conversation.');return;}
   if(control&&info.expired){stop('This browser session expired.');if(info.canReopen){needsReopen=true;const button=document.querySelector('[data-reconnect]');button.textContent='Reopen page';button.hidden=false;}return;}
   if(!response.ok)throw Error('Viewer unavailable');
   if(!info.active){stop('Task finished.');return;}
   if(info.modeChanged){stop('Browser control opened.');return;}
   const url=new URL(info.url);
   if(url.protocol!=='https:'||!['production-sfo.browserless.io','production-lon.browserless.io','production-ams.browserless.io'].includes(url.hostname)||url.username||url.password||url.port&&url.port!=='443')throw Error('Invalid viewer endpoint');
   const id=url.searchParams.get('i');if(!id||!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('Invalid stream identity');
   const timeout=url.searchParams.get('t');url.protocol='wss:';url.search='';url.pathname=url.pathname.replace('index.html','')+id;if(timeout)url.searchParams.set('timeout',timeout);
   if(socket){socket.onclose=socket.onerror=socket.onmessage=null;socket.close();}
   const ws=socket=new WebSocket(url.href);ws.binaryType='blob';
   let handled=false;
   const recover=(fresh)=>{if(stopped||handled||socket!==ws)return;handled=true;releaseInput();inputReady=false;ws.onclose=ws.onerror=ws.onmessage=null;ws.close();message('Reconnecting…');if(++retries>4){message('Live view disconnected. Tap Reconnect.');document.querySelector('[data-reconnect]').hidden=false;return;}timer=setTimeout(()=>connect(fresh),Math.min(250*retries,1500));};
   ws.onopen=()=>{if(stopped||socket!==ws)return;ws.send(JSON.stringify({command:'start',data:{width:1440,height:900}}));};
   ws.onmessage=event=>{
    if(stopped||socket!==ws)return;
    if(event.data instanceof Blob){frame(event.data);return;}
    let data;try{data=JSON.parse(event.data);}catch{return;}
    if(control&&data.command==='startComplete'){inputReady=true;restoreInput();}
    if(control)handleStreamEvent(data);
    // Provider stream completion is not agent completion. Ask the authenticated
    // server before replacing this view; never navigate or restart the task.
    if(data.command==='runComplete' && typeof data.data?.reason==='string' && /credential|secret|secure|protect|takeover/i.test(data.data.reason)){stop('Browser hidden during private input.');return;}
    if(control&&data.command==='runComplete'){stop('Control session ended. Return to the conversation.');return;}
    if(data.command==='runComplete'||data.command==='error')recover(true);
   };
   ws.onerror=()=>recover(false);ws.onclose=()=>recover(false);
  }catch{if(stopped)return;message('Reconnecting…');if(++retries<=4)timer=setTimeout(()=>connect(refresh),Math.min(500*retries,2000));else{message('Live view disconnected. Tap Reconnect.');document.querySelector('[data-reconnect]').hidden=false;}}
  finally{reconnecting=false;}
 }
 __TAKEOVER_INPUT__
 document.querySelector('[data-reconnect]').onclick=async()=>{if(needsReopen){const button=document.querySelector('[data-reconnect]');button.disabled=true;try{const response=await fetch(endpoint.split('?')[0],{method:'POST'});if(!response.ok)throw Error('Reopen failed');location.href=endpoint.split('?')[0]+'?control=1';}catch{message('Couldn’t reopen the page. Try again.');button.disabled=false;}return;}retries=0;document.querySelector('[data-reconnect]').hidden=true;connect(true);};
 window.addEventListener('pagehide',()=>{stop('');pending=null;},{once:true});
 message('Connecting to browser…');connect();
})();`.replace('__ENDPOINT__', JSON.stringify(endpoint)).replace('__TAKEOVER_INPUT__', control ? takeoverInputScript : '').replace('__CONTROL__',String(control));
  return { html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;background:#161414;overflow:hidden}canvas{width:100%;height:100%;object-fit:contain;display:block}canvas:not([data-ready]){visibility:hidden}canvas{touch-action:none;outline:none}.takeover-controls{position:absolute;top:0;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px}.takeover-controls[hidden]{display:none}.takeover-controls button{position:relative;display:grid;place-items:center;width:32px;height:32px;min-height:32px;margin:0;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:50%;background:rgba(38,36,36,.88);color:#e8e8e8;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 2px 10px rgba(0,0,0,.18)}.takeover-controls button::after{content:"";position:absolute;inset:-6px;border-radius:50%}.takeover-controls button:active{background:#555353}.takeover-controls button[aria-pressed=true]{background:#5b5959;border-color:rgba(255,255,255,.4);color:#fff}.takeover-controls svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.takeover-pointer{position:fixed;width:26px;height:26px;border:2px solid white;border-radius:50%;background:rgba(255,255,255,.12);box-shadow:0 0 0 1px rgba(0,0,0,.65),0 2px 8px rgba(0,0,0,.22);transform:translate(-50%,-50%);pointer-events:none;z-index:10}.takeover-pointer[data-pressed=true]{background:rgba(66,179,250,.35);border-color:#42b3fa}.takeover-pointer[hidden]{display:none}.browser-text{position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;pointer-events:none;font:16px system-ui}.feedback{position:absolute;top:50%;left:24px;right:24px;transform:translateY(-50%);text-align:center;color:#d1d1d1;font:13px -apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none}.feedback span{display:block;line-height:1.5}.feedback span[hidden]{display:none}button{pointer-events:auto;border:0;border-radius:14px;padding:10px 16px;margin:8px;font:inherit}</style></head><body><canvas aria-label="Live browser page"></canvas><div class="takeover-controls" hidden><button data-drag-mode aria-pressed="false" aria-label="Scroll mode" title="Switch to mouse dragging"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 14 10-7 1-3 7-4-18Z"/></svg></button><button data-browser-type aria-label="Keyboard" title="Keyboard" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg></button></div><textarea class="browser-text" data-browser-text hidden aria-label="Type in remote browser" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea><div class="feedback"><span role="status"></span><button data-reconnect hidden>Reconnect</button></div><script nonce="${nonce}">${script}</script></body></html>`,
    csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self' wss://production-sfo.browserless.io wss://production-lon.browserless.io wss://production-ams.browserless.io; img-src blob:; frame-ancestors 'self'; base-uri 'none'` };
}
