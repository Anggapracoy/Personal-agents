/** A full-screen sheet: the image, controls and dark surface move together. */
export function attachPhotoViewerMotion(viewer: HTMLDialogElement, dismiss: () => void) {
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easing = 'cubic-bezier(.2,.75,.2,1)';
  let animation: Animation | null = null;
  let closing = false;
  let drag: { id: number; x: number; y: number; offset: number; active: boolean } | null = null;
  const translateY = () => new DOMMatrixReadOnly(getComputedStyle(viewer).transform).m42;
  const animate = (from: string, to: string, duration: number) => {
    animation?.cancel();
    viewer.style.transform = from;
    animation = viewer.animate([{ transform: from }, { transform: to }], { duration, easing, fill: 'both' });
    return animation;
  };
  if (!reduced()) animate('translateY(100%)', 'translateY(0)', 320);

  const cancelDrag = () => {
    if (!drag) return;
    const active = drag.active;
    drag = null;
    if (active && !closing && !reduced()) animate(getComputedStyle(viewer).transform, 'translateY(0)', 240);
  };
  const close = () => {
    if (closing || !viewer.open) return;
    closing = true; drag = null;
    if (reduced()) { dismiss(); return; }
    const motion = animate(getComputedStyle(viewer).transform, 'translateY(100%)', 280);
    void motion.finished.then(dismiss).catch(() => undefined);
  };
  const start = (id: number, x: number, y: number, target: EventTarget | null) => {
    if (closing || (window.visualViewport?.scale ?? 1) > 1.01 || (target instanceof Element && target.closest('button, a, input, textarea, select'))) return;
    drag = { id, x, y, offset: 0, active: false };
  };
  const move = (id: number, x: number, y: number) => {
    if (!drag || drag.id !== id) return false;
    const dx = x - drag.x, dy = y - drag.y;
    if (!drag.active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return false;
      if (dy <= 0 || Math.abs(dx) > dy) { drag = null; return false; }
      drag.offset = translateY();
      animation?.cancel();
      drag.active = true;
    }
    if (!reduced()) viewer.style.transform = `translateY(${Math.max(0, drag.offset + dy)}px)`;
    return true;
  };
  const end = (id: number, x: number, y: number) => {
    if (!drag || drag.id !== id) return;
    const dy = y - drag.y, dx = Math.abs(x - drag.x);
    if (dy >= 90 && dy > dx * 1.25) close();
    else cancelDrag();
  };
  // Use touch events on phones: WebKit can cancel the compatibility pointer
  // stream as its image/scroll recognizers compete for the gesture.
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) { cancelDrag(); return; }
    const touch = event.touches[0];
    start(touch.identifier, touch.clientX, touch.clientY, event.target);
  };
  const touchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1.01) { cancelDrag(); return; }
    const touch = event.touches[0];
    if (move(touch.identifier, touch.clientX, touch.clientY) && event.cancelable) event.preventDefault();
  };
  const touchEnd = (event: TouchEvent) => {
    if (!drag) return;
    const touch = Array.from(event.changedTouches).find(touch => touch.identifier === drag?.id);
    if (touch) end(touch.identifier, touch.clientX, touch.clientY);
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return;
    start(event.pointerId, event.clientX, event.clientY, event.target);
  };
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    if (move(event.pointerId, event.clientX, event.clientY) && !viewer.hasPointerCapture(event.pointerId)) viewer.setPointerCapture(event.pointerId);
  };
  const pointerUp = (event: PointerEvent) => {
    // WebKit can coalesce a quick swipe into pointerup while changedTouches
    // still contains the starting position. The primary pointer has the final
    // coordinates; retain the touch identifier and multi-touch cancellation.
    if (event.pointerType === 'touch') {
      if (event.isPrimary && drag) end(drag.id, event.clientX, event.clientY);
    } else end(event.pointerId, event.clientX, event.clientY);
  };
  const pointerCancel = (event: PointerEvent) => { if (event.pointerType !== 'touch') cancelDrag(); };
  const lostCapture = (event: PointerEvent) => { if (event.target === viewer && event.pointerType !== 'touch') cancelDrag(); };
  const viewportChanged = () => {
    const zoomed = (window.visualViewport?.scale ?? 1) > 1.01;
    viewer.classList.toggle('is-zoomed', zoomed);
    if (zoomed) cancelDrag();
  };
  viewer.addEventListener('touchstart', touchStart, { passive: true });
  viewer.addEventListener('touchmove', touchMove, { passive: false });
  viewer.addEventListener('touchend', touchEnd);
  viewer.addEventListener('touchcancel', cancelDrag);
  viewer.addEventListener('pointerdown', pointerDown);
  viewer.addEventListener('pointermove', pointerMove);
  viewer.addEventListener('pointerup', pointerUp);
  viewer.addEventListener('pointercancel', pointerCancel);
  viewer.addEventListener('lostpointercapture', lostCapture);
  window.visualViewport?.addEventListener('resize', viewportChanged);
  viewportChanged();
  return { close, cancelDrag, dispose() {
    animation?.cancel();
    viewer.style.transform = '';
    viewer.classList.remove('is-zoomed');
    viewer.removeEventListener('touchstart', touchStart);
    viewer.removeEventListener('touchmove', touchMove);
    viewer.removeEventListener('touchend', touchEnd);
    viewer.removeEventListener('touchcancel', cancelDrag);
    viewer.removeEventListener('pointerdown', pointerDown);
    viewer.removeEventListener('pointermove', pointerMove);
    viewer.removeEventListener('pointerup', pointerUp);
    viewer.removeEventListener('pointercancel', pointerCancel);
    viewer.removeEventListener('lostpointercapture', lostCapture);
    window.visualViewport?.removeEventListener('resize', viewportChanged);
  } };
}
