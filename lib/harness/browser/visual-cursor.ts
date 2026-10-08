import { SIGNATURE_ARC_EXPRESSION } from "./signature-arc";

// Evaluated only by the trusted controller, in the top frame's isolated world.
// No website text, field values, focus changes, input events or network requests.
export const VISUAL_CURSOR_EXPRESSION = String.raw`(event => {
  const key = '__dashVisualCursor';
  const revision = 'signature-arc-v8';
  let cursor = globalThis[key];
  if (cursor && (!cursor.host.isConnected || cursor.revision !== revision)) { cursor.dispose(); cursor = null; }
  if (!cursor && event.kind !== 'move') return;
  if (!cursor) {
    const host = document.createElement('div');
    host.id = 'dash-visual-cursor';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;overflow:hidden!important;contain:strict!important;';
    // Closed shadow: page styles and our DOM/AX extraction cannot see the art.
    const root = host.attachShadow({mode:'closed'});
    const arrowPath = 'M6.4 3.5 C3 2.4 1.7 4.1 2.8 7.4 L7.1 20.8 C7.9 23.6 8.7 25.1 10.1 25.1 C11.6 25.1 12.4 23.4 13.3 21.4 L14.5 18.9 C15.3 17.1 16.3 16.1 18.1 15.3 L19.7 14.6 C22.6 13.3 24.1 12.2 24.1 10.7 C24.1 9.2 22.5 8.3 19.7 7.5 L6.4 3.5 Z';
    const artwork = '<style>:host,*{pointer-events:none!important}.position{position:absolute;left:0;top:0;opacity:0;will-change:transform,opacity}svg{position:absolute;left:-3.8px;top:-3.4px;width:36px;height:38px;overflow:visible}.sway{transform-origin:14.2px 15.6px}.sway.idle{animation:cursor-idle 1800ms ease-in-out infinite}@keyframes cursor-idle{0%,50%,100%{transform:rotate(0deg)}25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}@media(prefers-reduced-motion:reduce){.sway.idle{animation:none}}.halo{opacity:.58;filter:blur(6px)}.halo path{fill:rgb(var(--cursor-rgb,17,17,17));stroke:rgb(var(--cursor-rgb,17,17,17));stroke-width:4;stroke-linejoin:round}.arrow{filter:drop-shadow(0 0 5px rgba(var(--cursor-rgb,17,17,17),.4))}.ring{position:absolute;left:-15px;top:-15px;width:30px;height:30px;border:2px solid rgba(var(--cursor-rgb,17,17,17),.9);background:rgba(var(--cursor-rgb,17,17,17),.14);box-shadow:0 0 0 1px #ffffff90;border-radius:50%;box-sizing:border-box;opacity:0}</style><div class="position"><div class="sway"><svg class="halo" viewBox="0 0 26.5 28" aria-hidden="true"><path d="' + arrowPath + '"/></svg><svg class="arrow" viewBox="0 0 26.5 28" aria-hidden="true"><path d="' + arrowPath + '" fill="#111111" stroke="white" stroke-width="6.8" stroke-linejoin="round" paint-order="stroke fill"/></svg></div></div><div class="ring"></div>';
    // Constructed sheets are applied through CSSOM, so the page's policy for
    // inline <style> elements cannot strip the cursor's sizing/positioning.
    const styleEnd = artwork.indexOf('</style>');
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(artwork.slice(7, styleEnd));
    root.adoptedStyleSheets = [stylesheet];
    root.innerHTML = artwork.slice(styleEnd + 8);
    for (const svg of root.querySelectorAll('svg')) {
      svg.setAttribute('width', '36');
      svg.setAttribute('height', '38');
    }
    document.documentElement.appendChild(host);
    const position = root.querySelector('.position'), ring = root.querySelector('.ring'), arrow = root.querySelector('.arrow'), halo = root.querySelector('.halo');
    const sway = root.querySelector('.sway');
    let idleTimer = 0;
    const stopIdle = () => { clearTimeout(idleTimer); sway.classList.remove('idle'); };
    const scheduleIdle = () => { stopIdle(); if (!reduced.matches) idleTimer = setTimeout(() => { if(position.style.opacity === '1' && !frame) sway.classList.add('idle'); }, 650); };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let x = 0, y = 0, targetX = 0, targetY = 0, vx = 0, vy = 0;
    let initialized = false, frame = 0, last = 0;
    const planArc = ${SIGNATURE_ARC_EXPRESSION};
    let travel=null, travelStart=0;
    const paint = () => {
      position.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      arrow.style.rotate = (reduced.matches ? 0 : Math.max(-12,Math.min(12,vx*.008))) + 'deg';
      arrow.style.transformOrigin = '3.8px 3.4px';
      if(reduced.matches) halo.style.opacity='.4';
      else if(!halo.getAnimations().length) halo.style.opacity=String(.4+Math.min(.5,Math.hypot(vx,vy)/2400));
    };
    const pulse = () => {
      scheduleIdle();
      // Ripple marks the actual click immediately, independently of cursor travel.
      ring.style.left = (targetX-15) + "px"; ring.style.top = (targetY-15) + "px";
      halo.getAnimations().forEach(a => a.cancel());
      ring.getAnimations().forEach(a => a.cancel());
      arrow.getAnimations().forEach(a => a.cancel());
      ring.animate(reduced.matches ? [{opacity:.7},{opacity:0}] : [
        {transform:'scale(.35)',opacity:1},
        {transform:'scale(1.1)',opacity:.85,offset:.35},
        {transform:'scale(2.2)',opacity:0}
      ], {duration:reduced.matches ? 120 : 420,easing:'cubic-bezier(.2,.65,.3,1)'});
      if (!reduced.matches) {
        arrow.animate([{transform:'scale(1)'},{transform:'scale(.76)',offset:.22},{transform:'scale(1.07)',offset:.62},{transform:'scale(1)'}], {duration:280,easing:'ease-out'});
        halo.animate([{transform:'scale(1)',opacity:1},{transform:'scale(.78)',opacity:1,offset:.2},{transform:'scale(1.3)',opacity:.85,offset:.6},{transform:'scale(1)',opacity:1}], {duration:340,easing:'ease-out'});
      }
    };
    const tick = now => {
      if(reduced.matches) { motionChanged(); return; }
      const dt = Math.min((now - last) / 1000, .032); last = now;
      const progress=Math.min(1,(now-travelStart)/travel.duration);
      const point=travel.at(progress), previousX=x, previousY=y;
      x=point.x; y=point.y; vx=(x-previousX)/Math.max(.001,dt); vy=(y-previousY)/Math.max(.001,dt); paint();
      if(progress<1) frame=requestAnimationFrame(tick);
      else { x=targetX; y=targetY; vx=vy=0; frame=0; travel=null; paint(); scheduleIdle(); }
    };
    const hide = () => { stopIdle(); cancelAnimationFrame(frame); frame=0; travel=null; vx=vy=0; position.style.opacity='0'; ring.getAnimations().forEach(a=>a.cancel()); };
    const motionChanged = () => {
      if(!reduced.matches) return;
      const activeRipple=ring.getAnimations().length>0;
      for(const element of [halo,arrow,ring]) element.getAnimations().forEach(animation=>animation.cancel());
      if(activeRipple) ring.animate([{opacity:.7},{opacity:0}],{duration:120});
      cancelAnimationFrame(frame); frame=0; travel=null; x=targetX; y=targetY; vx=vy=0; stopIdle(); paint();
    };
    reduced.addEventListener('change',motionChanged);
    cursor = {
      revision,
      host,
      update(e) {
        if(e.kind === 'hide') { hide(); return; }
        if(e.kind === 'click') { if(position.style.opacity==='1') pulse(); return; }
        if(!Number.isFinite(e.x) || !Number.isFinite(e.y) || e.x<0 || e.y<0 || e.x>innerWidth || e.y>innerHeight) { hide(); return; }
        stopIdle();
        if (typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color)) {
          const rgb = [1,3,5].map(i => parseInt(e.color.slice(i,i+2),16)).join(',');
          position.style.setProperty('--cursor-rgb',rgb);
          ring.style.setProperty('--cursor-rgb',rgb);
        }
        if(!initialized || reduced.matches) { x=e.x; y=e.y; vx=vy=0; initialized=true; paint(); }
        const distance=Math.hypot(e.x-x,e.y-y);
        travel=planArc({x,y},{x:e.x,y:e.y}); travelStart=performance.now();
        targetX=e.x; targetY=e.y;
        position.style.opacity='1';
        if(reduced.matches || distance<=.3) { cancelAnimationFrame(frame); frame=0; travel=null; x=targetX; y=targetY; vx=vy=0; paint(); }
        if(!frame && !reduced.matches && distance>.3) { last=performance.now(); frame=requestAnimationFrame(tick); }
        if (!frame) scheduleIdle();
      },
      dispose() { hide(); reduced.removeEventListener('change',motionChanged); host.remove(); delete globalThis[key]; }
    };
    globalThis[key]=cursor;
  }
  cursor.update(event);
})`;

// Runs before page scripts, only in the top frame's dedicated isolated world.
// The controller supplies only decorative coordinates and colour, never storage.
export const CURSOR_RESTORE_EXPRESSION = String.raw`(event => {
  if (window !== top) return;
  const restore = () => (${VISUAL_CURSOR_EXPRESSION})(event);
  if (document.documentElement) restore();
  else {
    const observer = new MutationObserver(() => {
      if (document.documentElement) { observer.disconnect(); restore(); }
    });
    observer.observe(document, {childList:true});
  }
})`;

// Translate frame-local CSS coordinates into the owning frame's viewport.
// Pure geometry: no scrolling, focus, hit-testing or payment validation.
export const CURSOR_FRAME_POINT = String.raw`function(point) {
  const r=this.getBoundingClientRect();
  return {x:r.left+(this.clientLeft+point.x)*r.width/this.offsetWidth,
          y:r.top+(this.clientTop+point.y)*r.height/this.offsetHeight};
}`;
