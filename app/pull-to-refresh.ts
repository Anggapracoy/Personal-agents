export const REFRESH_THRESHOLD = 64;
export const MIN_REFRESH_DURATION = 1100;
export type RefreshState = { distance: number; refreshing: boolean; error: string };
/** Own only a downward, single-finger gesture that begins at the top. */
export function attachPullToRefresh(node: HTMLElement, refresh: () => Promise<void>, publish: (state: RefreshState) => void, minimumDuration = MIN_REFRESH_DURATION) {
  let origin: { x: number; y: number } | null = null;
  let distance = 0;
  let refreshing = false;
  let disposed = false;
  let claimed = false;
  let suppressClickUntil = 0;
  const update = (error = '') => { if (!disposed) publish({ distance, refreshing, error }); };
  const cancel = () => { origin = null; claimed = false; if (!refreshing) { distance = 0; update(); } };
  const start = (event: TouchEvent) => {
    if (refreshing || event.touches.length !== 1 || node.scrollTop > 0 || (event.target as Element)?.closest('input, textarea, [role="dialog"], [role="menu"]')) return;
    origin = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const move = (event: TouchEvent) => {
    if (!origin) return;
    if (event.touches.length !== 1) { cancel(); return; }
    const dx = event.touches[0].clientX - origin.x;
    const dy = event.touches[0].clientY - origin.y;
    if (!claimed && (dy < -5 || Math.abs(dx) > Math.max(10, Math.abs(dy)))) { cancel(); return; }
    if (dy <= 0) { distance = 0; update(); return; }
    if (!event.cancelable) { cancel(); return; }
    if (dy > 5) claimed = true;
    if (!claimed) return;
    event.preventDefault();
    distance = Math.min(96, dy * 0.45);
    update();
  };
  const run = async () => {
    if (refreshing || disposed) return;
    refreshing = true; distance = REFRESH_THRESHOLD; update();
    const minimumVisible = new Promise<void>(resolve => setTimeout(resolve, minimumDuration));
    let error = '';
    try { await refresh(); } catch { error = 'Couldn’t refresh. Pull down to try again.'; }
    finally { await minimumVisible; refreshing = false; distance = 0; update(error); }
  };
  const end = () => { if (claimed) suppressClickUntil = Date.now() + 350; const trigger = claimed && distance >= REFRESH_THRESHOLD; origin = null; claimed = false; if (trigger) void run(); else cancel(); };
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', cancel);
  const blockClick = (event: MouseEvent) => { if (claimed || Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); } };
  node.addEventListener('click', blockClick, true);
  return { refresh: run, dispose: () => { disposed = true; node.removeEventListener('touchstart', start); node.removeEventListener('touchmove', move); node.removeEventListener('touchend', end); node.removeEventListener('touchcancel', cancel); node.removeEventListener('click', blockClick, true); } };
}
