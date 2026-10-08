/** A small, damped spring per visible message; native scrolling remains in charge. */
export function attachBubbleMotion(page: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const springs = new Map<HTMLElement, { position: number; velocity: number }>();
  let frame = 0, previousFrame = 0, previousScroll = page.scrollTop;
  let fingerY = 0, touching = false, lastInput = -Infinity;
  const clear = () => {
    cancelAnimationFrame(frame); frame = 0; previousFrame = 0;
    for (const element of springs.keys()) { element.style.removeProperty('translate'); element.style.removeProperty('will-change'); }
    springs.clear(); previousScroll = page.scrollTop;
  };
  const animate = (time: number) => {
    frame = 0;
    const elapsed = previousFrame ? (time - previousFrame) / 1000 : 1 / 60;
    previousFrame = time;
    if (reduced.matches || elapsed > .25) { clear(); return; }
    for (const [element, spring] of springs) {
      if (!element.isConnected) { springs.delete(element); continue; }
      // Small integration steps keep the same feel on 60 Hz and 120 Hz screens.
      const steps = Math.ceil(Math.min(elapsed, .05) * 120);
      const dt = Math.min(elapsed, .05) / Math.max(1, steps);
      for (let i = 0; i < steps; i++) {
        spring.velocity += (-240 * spring.position - 26 * spring.velocity) * dt;
        spring.position += spring.velocity * dt;
      }
      if (Math.abs(spring.position) < .04 && Math.abs(spring.velocity) < .4) {
        element.style.removeProperty('translate'); element.style.removeProperty('will-change'); springs.delete(element);
      } else element.style.translate = `0 ${spring.position.toFixed(3)}px`;
    }
    if (springs.size) frame = requestAnimationFrame(animate);
    else previousFrame = 0;
  };
  const input = (event: PointerEvent | WheelEvent) => {
    if ('button' in event && event.button !== 0) return;
    fingerY = event.clientY; lastInput = performance.now();
    if (event.type === 'pointerdown') touching = true;
  };
  const move = (event: PointerEvent) => { if (touching) { fingerY = event.clientY; lastInput = performance.now(); } };
  const release = () => { if (touching) lastInput = performance.now(); touching = false; };
  const scroll = () => {
    const now = performance.now(), current = page.scrollTop;
    const delta = current - previousScroll; previousScroll = current;
    if (reduced.matches || (!touching && now - lastInput > 180) || !delta) return;
    lastInput = now; // Keep following the browser's momentum after finger-up.
    const bounds = page.getBoundingClientRect();
    const elements = page.querySelectorAll<HTMLElement>('.wd-thread > .wd-reactable, .wd-thread > .wd-agent, .wd-thread > .wd-user-turn, .wd-thread > .wd-photo-message, .wd-thread > .wd-message-time');
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
      const spring = springs.get(element) ?? { position: 0, velocity: 0 };
      const distance = Math.abs(rect.top + rect.height / 2 - spring.position - fingerY);
      const resistance = Math.min(.18, .015 + distance / Math.max(1, bounds.height) * .16);
      spring.position = Math.max(-14, Math.min(14, spring.position + Math.max(-80, Math.min(80, delta)) * resistance));
      springs.set(element, spring);
      element.style.willChange = 'translate';
      element.style.translate = `0 ${spring.position.toFixed(3)}px`;
    }
    if (!frame && springs.size) frame = requestAnimationFrame(animate);
  };
  const reset = () => { clear(); touching = false; lastInput = -Infinity; };
  page.addEventListener('pointerdown', input, { passive: true });
  page.addEventListener('pointermove', move, { passive: true });
  page.addEventListener('wheel', input, { passive: true });
  page.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  reduced.addEventListener('change', reset);
  return {
    reset,
    dispose() {
      reset();
      page.removeEventListener('pointerdown', input); page.removeEventListener('pointermove', move);
      page.removeEventListener('wheel', input); page.removeEventListener('scroll', scroll);
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      reduced.removeEventListener('change', reset);
    },
  };
}
