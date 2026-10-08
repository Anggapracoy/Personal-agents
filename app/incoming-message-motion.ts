/** Measured from a live Messages reply: the surface expands; text never scales. */
export function animateIncomingMessage(surface: HTMLElement, from = { width: 59, height: 37 }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bounds = surface.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !surface.parentElement) return;
  const background = surface.style.backgroundColor;
  const parent = surface.parentElement;
  const isolation = parent.style.isolation;
  parent.style.isolation = 'isolate';
  const ghost = document.createElement('div');
  ghost.className = 'wd-agent wd-incoming-surface';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { position: 'absolute', left: `${surface.offsetLeft}px`, bottom: `${parent.clientHeight - surface.offsetTop - surface.offsetHeight}px`, padding: '0', maxWidth: 'none', pointerEvents: 'none', zIndex: '-1', backgroundColor: getComputedStyle(surface).backgroundColor });
  surface.style.backgroundColor = 'transparent';
  parent.append(ghost);
  const shape = ghost.animate([
    { width: `${Math.min(from.width, bounds.width)}px`, height: `${Math.min(from.height, bounds.height)}px` },
    { width: `${bounds.width}px`, height: `${bounds.height}px` }
  ], { duration: 140, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'both' });
  const reveal = surface.animate([
    { clipPath: `inset(${Math.max(0, bounds.height - from.height)}px ${Math.max(0, bounds.width - from.width)}px 0 0 round 20px)` },
    { clipPath: 'inset(0px 0px 0px 0px round 20px)' }
  ], { duration: 140, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'both' });
  reveal.pause(); reveal.currentTime = 0;
  const text = surface.querySelector<HTMLElement>('.wd-message-markdown');
  const ink = text?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 110, delay: 30, easing: 'ease-out', fill: 'backwards' });
  shape.pause(); shape.currentTime = 0;
  if (ink) { ink.pause(); ink.currentTime = 0; }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (surface.isConnected) {
      // Adding the temporary surface can settle shrink-to-fit layout. Use the
      // real bubble's final layout size, not the earlier presentation bounds.
      const final = surface.getBoundingClientRect();
      ghost.style.left = `${surface.offsetLeft}px`;
      ghost.style.bottom = `${parent.clientHeight - surface.offsetTop - surface.offsetHeight}px`;
      (shape.effect as KeyframeEffect).setKeyframes([
        { width: `${Math.min(from.width, final.width)}px`, height: `${Math.min(from.height, final.height)}px` },
        { width: `${final.width}px`, height: `${final.height}px` }
      ]);
      (reveal.effect as KeyframeEffect).setKeyframes([
        { clipPath: `inset(${Math.max(0, final.height - from.height)}px ${Math.max(0, final.width - from.width)}px 0 0 round 20px)` },
        { clipPath: 'inset(0px 0px 0px 0px round 20px)' }
      ]);
      shape.play(); reveal.play(); ink?.play();
    }
    else { shape.cancel(); reveal.cancel(); ink?.cancel(); }
  }));
  const restore = () => { reveal.cancel(); surface.style.backgroundColor = background; parent.style.isolation = isolation; ghost.remove(); };
  void shape.finished.then(restore, restore);
}
