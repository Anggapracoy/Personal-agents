// Touch listeners retain vertical scrolling until horizontal intent is clear.
export function attachRowSwipe(row: HTMLElement, front: HTMLElement, action: HTMLButtonElement, commit: () => Promise<boolean>, confirm?: () => Promise<boolean>) {
  let x = 0, target = 0, velocity = 0, frame = 0, disposed = false, saving = false, suppressUntil = 0;
  let drag: { startX: number; startY: number; origin: number; lastX: number; time: number; claimed: boolean } | null = null;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const publish = () => row.dispatchEvent(new CustomEvent('conversationSwipe', { bubbles: true }));
  const symbol = action.querySelector<HTMLElement>('.wd-swipe-symbol');
  const paint = (next: number) => {
    x = Math.min(0, Math.max(-row.clientWidth, next));
    front.style.transform = `translate3d(${x}px,0,0)`;
    action.style.width = `${Math.max(82, -x)}px`;
    if (symbol) {
      const reveal = Math.min(1, Math.max(0, -x / 82));
      const stretch = Math.min(1, Math.max(0, (-x - 82) / Math.max(1, row.clientWidth * .6 - 82)));
      const easedStretch = stretch * stretch * (3 - 2 * stretch);
      symbol.style.width = `${48 + Math.max(0, -x - 82) * easedStretch}px`;
      symbol.style.transform = `scale(${reduced() ? 1 : .15 + .85 * reveal})`;
      symbol.style.opacity = `${reduced() ? 1 : reveal}`;
    }
    action.inert = x > -1;
    const state = x < -1 ? 'open' : 'closed';
    if (row.dataset.swipe !== state) { row.dataset.swipe = state; publish(); }
    row.classList.toggle('is-full-swipe', -x >= row.clientWidth * .6);
  };
  const spring = (nextTarget: number, done?: () => void) => {
    target = nextTarget;
    cancelAnimationFrame(frame);
    if (reduced()) { paint(target); done?.(); return; }
    const started = performance.now();
    let previous = started;
    const tick = (time: number) => {
      if (disposed) return;
      const dt = Math.min((time - previous) / 1000, .032); previous = time;
      const d = x - target, c = velocity + 24 * d, decay = Math.exp(-24 * dt);
      velocity = (velocity - 24 * c * dt) * decay;
      paint(target + (d + c * dt) * decay);
      if (time - started >= 1000 || (Math.abs(x - target) < .1 && Math.abs(velocity) < 2)) { paint(target); velocity = 0; done?.(); }
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  const close = () => { if (!saving) { drag = null; spring(0); } };
  const expandForConfirmation = () => new Promise<void>(resolve => {
    cancelAnimationFrame(frame);
    const start = x, end = -row.clientWidth;
    if (reduced() || Math.abs(end - start) < .5) { paint(end); velocity = 0; resolve(); return; }
    const started = performance.now();
    const tick = (time: number) => {
      if (disposed) { resolve(); return; }
      const progress = Math.min(1, (time - started) / 250);
      paint(start + (end - start) * (1 - Math.pow(1 - progress, 3)));
      if (progress === 1) { velocity = 0; resolve(); }
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
  const archive = async () => {
    if (saving || action.disabled) return;
    saving = true; suppressUntil = Infinity;
    if (confirm) {
      // Finish the release motion before UIKit takes over touch handling.
      // Otherwise the row freezes at the exact finger-up position.
      row.dataset.confirmingArchive = "true";
      await expandForConfirmation();
      if (disposed) return;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      let accepted = false;
      try { accepted = await confirm(); } catch { }
      if (disposed) return;
      if (!accepted) { delete row.dataset.confirmingArchive; saving = false; suppressUntil = performance.now() + 300; spring(0); return; }
    }
    const finishSwipe = action.animate([
      { transform: 'translate3d(0,0,0)', opacity: 1 },
      { transform: `translate3d(${-row.clientWidth}px,0,0)`, opacity: 0 }
    ], { duration: reduced() ? 0 : 200, fill: 'forwards', easing: 'cubic-bezier(.32,0,.67,0)' });
    try { await finishSwipe.finished; } catch { return; }
    if (disposed) return;
    spring(-row.clientWidth, () => {
      const height = row.getBoundingClientRect().height;
      row.style.height = `${height}px`;
      const collapse = row.animate([{ height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: reduced() ? 0 : 180, fill: 'forwards', easing: 'ease-out' });
      void collapse.finished.then(async () => {
        let success = false;
        try { success = await commit(); } catch { /* Existing action error is rendered by Home. */ }
        if (!success && !disposed) { finishSwipe.cancel(); collapse.cancel(); delete row.dataset.confirmingArchive; row.style.height = ''; saving = false; suppressUntil = performance.now() + 300; spring(0); }
      }).catch(() => {});
    });
  };
  const start = (px: number, py: number) => {
    if (saving || action.disabled) return;
    cancelAnimationFrame(frame); velocity = 0;
    // Rebase every new gesture on the painted position, including a settling row.
    drag = { startX: px, startY: py, origin: x, lastX: px, time: performance.now(), claimed: false };
  };
  const move = (px: number, py: number, event: Event) => {
    if (!drag) return;
    const dx = px - drag.startX, dy = py - drag.startY;
    if (!drag.claimed) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { drag = null; spring(0); return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      if (dx > 0 && drag.origin === 0) { drag = null; return; }
      drag.claimed = true;
      document.dispatchEvent(new CustomEvent('closeConversationSwipes', { detail: row }));
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now();
    velocity = (px - drag.lastX) / Math.max(.008, (now - drag.time) / 1000);
    drag.lastX = px; drag.time = now;
    paint(Math.min(0, Math.max(-row.clientWidth, drag.origin + dx)));
    suppressUntil = now + 400;
  };
  const end = (cancelled = false) => {
    if (!drag) return;
    const claimed = drag.claimed; const stale = performance.now() - drag.time > 100; drag = null;
    // A tap or cancellation can interrupt a settling row before claiming a drag.
    // Resume its destination instead of leaving the foreground stranded.
    if (!claimed) { velocity = 0; spring(cancelled ? 0 : target); return; }
    if (stale || cancelled) velocity = 0;
    suppressUntil = performance.now() + 400;
    if (!cancelled && -x >= row.clientWidth * .6) archive();
    else spring(!cancelled && x + velocity * .12 < -41 ? -82 : 0);
  };
  const touchStart = (e: TouchEvent) => { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); else end(true); };
  const touchMove = (e: TouchEvent) => { if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY, e); else end(true); };
  const touchEnd = () => end(); const cancel = () => end(true);
  const pointerStart = (e: PointerEvent) => { if (e.pointerType === 'mouse' && e.button === 0) start(e.clientX, e.clientY); };
  const pointerMove = (e: PointerEvent) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY, e); };
  const pointerEnd = (e: PointerEvent) => { if (e.pointerType === 'mouse') end(); };
  const pointerCancel = (e: PointerEvent) => { if (e.pointerType === 'mouse') end(true); };
  const click = (e: MouseEvent) => { if (performance.now() < suppressUntil || x < -1) { e.preventDefault(); e.stopImmediatePropagation(); if (!saving && performance.now() >= suppressUntil) close(); } };
  const context = (e: Event) => { if (drag?.claimed || x < -1) { e.preventDefault(); e.stopImmediatePropagation(); } };
  const outside = (e: Event) => { if (!row.contains(e.target as Node)) close(); };
  const other = (e: Event) => { if ((e as CustomEvent).detail !== row) close(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft' && row.contains(document.activeElement)) { e.preventDefault(); document.dispatchEvent(new CustomEvent('closeConversationSwipes', { detail: row })); spring(-82, () => action.focus()); } };
  const scroll = () => { if (!drag) close(); };
  const home = row.closest('.wd-home');
  row.addEventListener('touchstart', touchStart, { passive: true });
  row.addEventListener('touchmove', touchMove, { passive: false });
  row.addEventListener('touchend', touchEnd); row.addEventListener('touchcancel', cancel);
  row.addEventListener('pointerdown', pointerStart); document.addEventListener('pointermove', pointerMove); document.addEventListener('pointerup', pointerEnd); document.addEventListener('pointercancel', pointerCancel);
  front.addEventListener('click', click, true); front.addEventListener('contextmenu', context, true);
  const actionClick = (event: MouseEvent) => { if (performance.now() < suppressUntil) { event.preventDefault(); return; } archive(); };
  action.addEventListener('click', actionClick); document.addEventListener('pointerdown', outside); document.addEventListener('closeConversationSwipes', other); row.addEventListener('keydown', key); home?.addEventListener('scroll', scroll);
  paint(0);
  return () => {
    disposed = true; cancelAnimationFrame(frame);
    row.removeEventListener('touchstart', touchStart); row.removeEventListener('touchmove', touchMove); row.removeEventListener('touchend', touchEnd); row.removeEventListener('touchcancel', cancel);
    row.removeEventListener('pointerdown', pointerStart); document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', pointerEnd); document.removeEventListener('pointercancel', pointerCancel);
    front.removeEventListener('click', click, true); front.removeEventListener('contextmenu', context, true); action.removeEventListener('click', actionClick);
    document.removeEventListener('pointerdown', outside); document.removeEventListener('closeConversationSwipes', other); row.removeEventListener('keydown', key); home?.removeEventListener('scroll', scroll);
  };
}
