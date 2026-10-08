/** Track native overlays while layout changes, rather than polling forever at rest. */
export function trackNativeLayout(resolve: () => HTMLElement | null, publish: () => void) {
  let frame = 0;
  let disposed = false;
  let target: HTMLElement | null = null;
  let ancestors: HTMLElement[] = [];
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(tick); };
  const attributes = new MutationObserver(schedule);
  const resize = new ResizeObserver(schedule);
  const retarget = () => {
    const next = resolve();
    if (next === target && ancestors.every(node => node.isConnected)) return;
    attributes.disconnect(); resize.disconnect(); target = next; ancestors = [];
    for (let node = next; node; node = node.parentElement) {
      ancestors.push(node);
      attributes.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'inert', 'disabled', 'aria-label'] });
    }
    if (next) resize.observe(next);
  };
  function tick() {
    frame = 0;
    if (disposed) return;
    retarget();
    publish();
    // WAAPI transforms don't change layout or attributes. Follow only active
    // motion on the control or its ancestors; descendants' idle art is irrelevant.
    if (ancestors.some(node => node.getAnimations().some(animation => animation.playState === 'running' || animation.pending))) schedule();
  }
  // The sheet animator dispatches this from its own rAF. Sample now so native
  // controls and the sheet mask describe the same animation frame.
  const flushLayout = () => { cancelAnimationFrame(frame); frame = 0; tick(); };
  const children = new MutationObserver(schedule);
  if (document.body) children.observe(document.body, { childList: true, subtree: true });
  for (const event of ['resize', 'scroll', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown']) window.addEventListener(event, schedule, true);
  window.addEventListener('decisionFeed:sheetLayout', flushLayout);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  retarget(); schedule();
  return {
    schedule,
    dispose() {
      disposed = true; cancelAnimationFrame(frame); attributes.disconnect(); resize.disconnect(); children.disconnect();
      for (const event of ['resize', 'scroll', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown']) window.removeEventListener(event, schedule, true);
      window.removeEventListener('decisionFeed:sheetLayout', flushLayout);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
    },
  };
}
