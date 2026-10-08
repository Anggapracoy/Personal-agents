export type ComposerSendOrigin = { x: number; y: number; width: number; height: number; nativeFlight?: boolean; nativeFlightId?: string; feedbackPlayed?: boolean };
type PendingSend = {
  text: string; source: ComposerSendOrigin; font: string; color: string; lineHeight: string;
  before: Map<HTMLElement, DOMRect>; ids: Set<string>; fromHome: boolean; nativeFlight: boolean; nativeFlightId?: string; createdAt: number; cancel?: () => void;
};
const pending = new WeakMap<HTMLElement, PendingSend>();
const active = new WeakMap<HTMLElement, () => void>();
const duration = 550;
const finiteOrigin = (value?: ComposerSendOrigin): value is ComposerSendOrigin => Boolean(value && [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0);
const number = (value: string) => parseFloat(value) || 0;
// Measured at 60 fps from the supplied Messages recording, starting at 4.917s.
// Vertical travel stops at the destination; only width contraction may overshoot.
// Columns: horizontal contraction, vertical travel, height scale (glass refraction is rendered by the native composer).
export const sendMotionSamples = [
  [0.00000, 0.00000, 1.00000],
  [0.07884, 0.00000, 1.00000],
  [0.16183, 0.00000, 1.00000],
  [0.26556, 0.00000, 1.00000],
  [0.39834, 0.03448, 1.00000],
  [0.56017, 0.08621, 1.00000],
  [0.71784, 0.15517, 1.00000],
  [0.85892, 0.24138, 1.00000],
  [0.96680, 0.31034, 1.00000],
  [1.03320, 0.39655, 1.00000],
  [1.06639, 0.46552, 1.00000],
  [1.07469, 0.55172, 1.00000],
  [1.07469, 0.62069, 1.00000],
  [1.07469, 0.68966, 1.00000],
  [1.06639, 0.74138, 1.00000],
  [1.05809, 0.81034, 1.00000],
  [1.05809, 0.84483, 1.00000],
  [1.04979, 0.89655, 1.00000],
  [1.04149, 0.93103, 1.00000],
  [1.03320, 0.94828, 1.00000],
  [1.02490, 0.98276, 1.00000],
  [1.02490, 1.00000, 1.00000],
  [1.01660, 1.00000, 1.00000],
  [1.01660, 1.00000, 1.00000],
  [1.01660, 1.00000, 1.00000],
  [1.00830, 1.00000, 1.00000],
  [1.00830, 1.00000, 1.00000],
  [1.00830, 1.00000, 1.00000],
  [1.00830, 1.00000, 1.00000],
  [1.00000, 1.00000, 1.00000],
  [1.00000, 1.00000, 1.00000],
  [1.00000, 1.00000, 1.00000],
  [1.00000, 1.00000, 1.00000],
  [1.00000, 1.00000, 1.00000]
];
export function sendProgress(elapsed: number) {
  const index = Math.max(0, Math.min(1, elapsed / duration)) * (sendMotionSamples.length - 1);
  const lo = Math.floor(index), hi = Math.min(sendMotionSamples.length - 1, lo + 1);
  return sendMotionSamples[lo][1] + (sendMotionSamples[hi][1] - sendMotionSamples[lo][1]) * (index - lo);
}
const horizontal = sendMotionSamples.map(sample => sample[0]);
type FlightWindow = Window & { __decisionFeedNativeSendFlight?: boolean; webkit?: { messageHandlers?: { decisionFeedNative?: { postMessage: (message: unknown) => void } } } };
const nativeFlightMessage = (payload: Record<string, unknown>) => (window as FlightWindow).webkit?.messageHandlers?.decisionFeedNative?.postMessage({ version: 1, action: 'messageSendFlight', payload });

/** Capture the actual draft before it clears. Server/read updates never create a send animation. */
export function prepareMessageSend(form: HTMLFormElement | null, text: string, nativeOrigin?: ComposerSendOrigin) {
  const root = form?.closest<HTMLElement>('.wd');
  if (!form || !root) return () => {};
  active.get(root)?.();
  const field = form.querySelector<HTMLTextAreaElement>('textarea');
  const fieldRect = field?.getBoundingClientRect();
  const style = getComputedStyle(field ?? root);
  let source: ComposerSendOrigin;
  const native = form.classList.contains('is-native');
  if (finiteOrigin(nativeOrigin)) source = nativeOrigin;
  else if (fieldRect?.width && !native) source = {
    x: fieldRect.left + number(style.paddingLeft), y: fieldRect.top + number(style.paddingTop),
    width: fieldRect.width - number(style.paddingLeft) - number(style.paddingRight),
    height: fieldRect.height - number(style.paddingTop) - number(style.paddingBottom),
  };
  else {
    // Older wrappers do not report the field frame. Keep the same native layout
    // as a compatible fallback until the next binary is installed.
    const rect = root.getBoundingClientRect(), css = getComputedStyle(root);
    const keyboard = number(css.getPropertyValue('--native-keyboard-height'));
    const extra = number(css.getPropertyValue('--composer-extra-height'));
    const bottom = rect.bottom - keyboard - (keyboard ? 2 : Math.max(2, number(css.getPropertyValue('--safe-bottom'))));
    source = { x: rect.left + 88, y: bottom - 52 - extra + 15, width: Math.max(1, rect.width - 154), height: 22 + extra };
  }
  const page = root.querySelector<HTMLElement>('.wd-front-layer .wd-task');
  const before = new Map<HTMLElement, DOMRect>();
  for (const node of page?.querySelectorAll<HTMLElement>('.wd-thread > *') ?? []) {
    const rect = node.getBoundingClientRect();
    before.set(node, rect);
  }
  const entry: PendingSend = {
    text: text.trim(), source, before,
    fromHome: form.classList.contains('is-home'),
    nativeFlight: nativeOrigin?.nativeFlight === true,
    nativeFlightId: nativeOrigin?.nativeFlightId,
    font: native ? '17px -apple-system, BlinkMacSystemFont, sans-serif' : style.font,
    color: native ? getComputedStyle(root).getPropertyValue('--ink') : style.color,
    lineHeight: native ? '20.3px' : style.lineHeight,
    ids: new Set(Array.from(page?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [], node => node.dataset.messageId!)),
    createdAt: performance.now(),
  };
  if (entry.fromHome) {
    // The destination mounts during the page slide. Keep its first bubble and
    // timestamp from painting before the flight is ready to reveal them.
    root.dataset.homeSendPending = 'true';
    root.dataset.homeSendTimeHidden = 'true';
  }
  pending.set(root, entry);
  window.setTimeout(() => {
    if (pending.get(root) !== entry) return;
    pending.delete(root);
    if (entry.nativeFlight) nativeFlightMessage({cancel: true, token: entry.nativeFlightId});
    if (entry.fromHome) { delete root.dataset.homeSendPending; delete root.dataset.homeSendTimeHidden; }
  }, 2_500);
  return () => {
    if (pending.get(root) === entry) pending.delete(root);
    entry.cancel?.();
    if (entry.nativeFlight) nativeFlightMessage({cancel: true, token: entry.nativeFlightId});
    if (entry.fromHome) { delete root.dataset.homeSendPending; delete root.dataset.homeSendTimeHidden; }
  };
}

/** A deliberate local Send follows the new turn even when the reader was in history. */
export function hasPendingMessageSend(page: HTMLElement) {
  const root = page.closest<HTMLElement>('.wd');
  return Boolean(root && pending.has(root));
}

/** Called after React lays out the new turn and establishes its scroll position. */
export function animateMessageSend(page: HTMLElement) {
  const root = page.closest<HTMLElement>('.wd');
  if (!root) return;
  const entry = pending.get(root);
  if (!entry) return;
  if (performance.now() - entry.createdAt > 2_000) {
    pending.delete(root);
    if (entry.nativeFlight) nativeFlightMessage({cancel: true, token: entry.nativeFlightId});
    if (entry.fromHome) { delete root.dataset.homeSendPending; delete root.dataset.homeSendTimeHidden; }
    return;
  }
  const turn = Array.from(page.querySelectorAll<HTMLElement>('.wd-thread > .wd-user-turn[data-message-id]')).at(-1);
  if (!turn || entry.ids.has(turn.dataset.messageId!)) return;
  if (turn.querySelector('.wd-photo-message, .wd-file-message')) {
    pending.delete(root);
    if (entry.nativeFlight) nativeFlightMessage({cancel:true, token:entry.nativeFlightId});
    delete root.dataset.homeSendPending;
    delete root.dataset.homeSendTimeHidden;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.dataset.sendingMessage = 'true';
    page.scrollTop = page.scrollHeight;
    const bounds = turn.getBoundingClientRect();
    const travel = Math.max(0, entry.source.y - bounds.bottom);
    const motion = turn.animate([
      {transform:`translateY(${travel}px) scale(.3)`, opacity:.5},
      {transform:'translateY(-1px) scale(1.01)', opacity:1, offset:.8},
      {transform:'translateY(0) scale(1)', opacity:1},
    ], {duration:400, easing:'cubic-bezier(.2,.8,.2,1)'});
    const previousOrigin = turn.style.transformOrigin;
    turn.style.transformOrigin = 'right bottom';
    const cleanup = () => {
      motion.cancel(); turn.style.transformOrigin = previousOrigin;
      delete root.dataset.sendingMessage;
      root.removeEventListener('pointerdown', cleanup);
      root.removeEventListener('wheel', cleanup);
      if (active.get(root) === cleanup) active.delete(root);
    };
    motion.onfinish = cleanup;
    entry.cancel = cleanup; active.set(root, cleanup);
    root.addEventListener('pointerdown', cleanup, {passive:true});
    root.addEventListener('wheel', cleanup, {passive:true});
    return;
  }
  let bubble = turn.querySelector<HTMLElement>('.wd-bubble.is-me, .wd-location-card');
  if (!bubble || (entry.text && !bubble.textContent?.trim().startsWith(entry.text))) return;
  pending.delete(root);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) {
    if (entry.nativeFlight) nativeFlightMessage({cancel: true, token: entry.nativeFlightId});
    if (entry.fromHome) { delete root.dataset.homeSendPending; delete root.dataset.homeSendTimeHidden; }
    return;
  }
  root.dataset.sendingMessage = 'true';
  page.scrollTop = page.scrollHeight;
  const text = bubble.textContent;
  const target = bubble.getBoundingClientRect();
  const css = getComputedStyle(bubble);
  const paddingX = number(css.paddingLeft), paddingY = number(css.paddingTop);
  const dy = entry.source.y - paddingY - target.top;
  const nativeFlight = entry.nativeFlight && bubble.matches('.wd-bubble.is-me');
  const sourceWidth = entry.source.width + 2 * paddingX;
  const dx = target.width - sourceWidth;
  const sourceHeight = entry.source.height + 2 * paddingY;
  const enteringX = page.closest<HTMLElement>('.wd-front-layer');
  const pageOffsetX = enteringX ? new DOMMatrixReadOnly(getComputedStyle(enteringX).transform).m41 : 0;
  const fromX = entry.source.x + entry.source.width - sourceWidth;
  // The departing surface starts inside the composer, including its glass refraction.
  const fromY = entry.source.y - paddingY;
  const toX = target.left - pageOffsetX;
  const toY = target.top;
  const shifts = Array.from(entry.before, ([node, rect]) => ({ node, delta: rect.top - node.getBoundingClientRect().top }))
    .filter(({node, delta}) => node.isConnected && Math.abs(delta) > .5);

  const ghost = document.createElement('div');
  ghost.className = 'wd-send-flight'; ghost.setAttribute('aria-hidden', 'true');
  if (nativeFlight) ghost.style.display = 'none';
  // Keep flight outside the scrollport: transformed overflow inside a message
  // changes scrollHeight and can clip the draft before it clears the composer.
  const anchor = document.createElement('div');
  Object.assign(anchor.style, {position:'fixed', left:'0', top:'0', width:'0', height:'0', zIndex:'1000', pointerEvents:'none', transform:entry.fromHome ? 'translate3d(0,0,0)' : `translate3d(${target.left}px, ${target.top}px, 0)`});
  Object.assign(ghost.style, { position: 'absolute', left: '0', top: '0', width: `${target.width}px`, height: `${target.height}px`, zIndex: '2', visibility: 'visible', pointerEvents: 'none', overflow: 'visible', borderRadius: css.borderRadius, color: css.color, transformOrigin: 'top left' });
  const surface = document.createElement('div');
  surface.className = `wd-send-surface${bubble.matches('.wd-bubble.is-me') ? ' has-tail' : ''}`;
  surface.style.setProperty('--message-body-height', `${target.height}px`);
  surface.style.setProperty('--message-blue-bottom', css.getPropertyValue('--message-blue-bottom') || '#008bff');
  Object.assign(surface.style, { position: 'absolute', inset: '0', background: css.background, borderRadius: 'inherit', transformOrigin: 'top left' });
  const destination = bubble.cloneNode(true) as HTMLElement;
  destination.classList.add('wd-send-destination'); destination.removeAttribute('id');
  for (const node of destination.querySelectorAll('[id]')) node.removeAttribute('id');
  Object.assign(destination.style, { position: 'absolute', left: '0', top: '0', width: `${target.width}px`, height: `${target.height}px`, margin: '0', visibility: 'visible', background: 'transparent', maxWidth: 'none', transform: 'none', translate: 'none', font:css.font, lineHeight:css.lineHeight, letterSpacing:css.letterSpacing, color:css.color, padding:css.padding, borderRadius:css.borderRadius, boxSizing:css.boxSizing });
  const sourceText = document.createElement('div');
  sourceText.textContent = entry.text;
  Object.assign(sourceText.style, { position: 'absolute', left: `${paddingX}px`, top: `${paddingY}px`, width: `${Math.min(entry.source.width, sourceWidth - 2 * paddingX)}px`, height: `${entry.source.height}px`, overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: entry.font, lineHeight: entry.lineHeight, color: css.color });
  ghost.append(surface, destination, sourceText);
  let priorVisibility = bubble.style.visibility;
  bubble.style.visibility = 'hidden'; anchor.append(ghost); root.append(anchor);
  const animations: Animation[] = [];
  const animate = (node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions = {}) => {
    const animation = node.animate(frames, { duration, fill: 'both', ...options });
    animation.pause(); animation.currentTime = 0;
    animations.push(animation); return animation;
  };
  animate(ghost, horizontal.map((x, index) => {
    const progress = sendProgress(index * duration / (horizontal.length - 1));
    return { offset: index / (horizontal.length - 1), transform: entry.fromHome
      ? `translate3d(${fromX + (toX - fromX) * x}px, ${fromY + (toY - fromY) * progress}px, 0)`
      : `translate3d(${dx * (1 - x)}px, ${dy * (1 - progress)}px, 0)` };
  }));
  animate(surface, horizontal.map((x, index) => ({ offset: index / (horizontal.length - 1), transform: `scale(${1 + (sourceWidth / target.width - 1) * (1 - x)}, ${1 + (sourceHeight / target.height - 1) * (1 - sendProgress(index * duration / (horizontal.length - 1)))})` })));
  // Messages paints the departing bubble on the first frame. Fading its whole
  // surface from transparent leaves a blank composer before the lift begins.
  if (entry.fromHome) {
    // The Home editor is already cleared by the native send transaction. Show
    // the bubble's own text from takeoff so there is no blank blue first frame.
    sourceText.style.display = 'none';
  } else {
    animate(sourceText, [{opacity:1}, {opacity:0}], {duration:80});
    animate(destination, [{opacity:0}, {opacity:1}], {duration:80});
  }
  for (const {node, delta} of shifts) animate(node, [{transform:`translate3d(0, ${delta}px, 0)`}, {transform:'translate3d(0, 0, 0)'}], {duration:300, easing:'cubic-bezier(.2, .8, .2, 1)'});
  let finished = false;
  let nativeLanded = false;
  let elapsed = 0, previous = performance.now();
  const tick = (timestamp: number) => {
    // The flight and page slide start together. Waiting for the destination to
    // settle leaves a bubble frozen over Home before it suddenly shoots upward.
    // Native keyboard transactions can delay a WebKit presentation. Advance by
    // at most one display interval so a delayed frame cannot skip the takeoff.
    elapsed = Math.min(duration, elapsed + Math.min(20, Math.max(0, timestamp - previous)));
    previous = timestamp;
    for (const animation of animations) animation.currentTime = elapsed;
    if (entry.fromHome && elapsed >= duration * .85) delete root.dataset.homeSendTimeHidden;
    if (elapsed < duration) startFrame = requestAnimationFrame(tick);
    else if (!nativeFlight) cleanup();
  };
  let startFrame = requestAnimationFrame(tick);
  // Only layout changes read geometry. Animation frames change transforms and
  // opacity, never bubble dimensions or the thread layout.
  let lastTarget = target;
  const trackLayout = () => {
    if (entry.fromHome) return;
    if (!bubble!.isConnected) return;
    const rect = bubble!.getBoundingClientRect();
    anchor.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    if (nativeFlight && [rect.left - lastTarget.left, rect.top - lastTarget.top, rect.width - lastTarget.width, rect.height - lastTarget.height].some(delta => Math.abs(delta) > .25)) {
      nativeFlightMessage({id: turn.dataset.messageId, token: entry.nativeFlightId, retarget: true, x: rect.left, y: rect.top, width: rect.width, height: rect.height});
    }
    lastTarget = rect;
  };
  const viewport = new ResizeObserver(trackLayout);
  viewport.observe(page);
  const thread = page.querySelector('.wd-thread');
  if (thread) viewport.observe(thread);
  page.addEventListener('scroll', trackLayout, {passive:true});
  const cleanup = () => {
    if (finished) return;
    finished = true; cancelAnimationFrame(startFrame); observer.disconnect(); viewport.disconnect();
    page.removeEventListener('scroll', trackLayout);
    for (const animation of animations) animation.cancel();
    anchor.remove(); bubble!.style.visibility = priorVisibility;
    delete root.dataset.sendingMessage;
    if (entry.fromHome) { delete root.dataset.homeSendPending; delete root.dataset.homeSendTimeHidden; }
    root.removeEventListener('pointerdown', cleanup); root.removeEventListener('wheel', cleanup);
    document.removeEventListener('visibilitychange', cleanup); reduced.removeEventListener('change', cleanup);
    window.removeEventListener('decisionFeed:sendFlightFinished', nativeFinished);
    window.clearTimeout(nativeFallback);
    if (nativeFlight && !nativeLanded) nativeFlightMessage({cancel: true, token: entry.nativeFlightId});
    if (active.get(root) === cleanup) active.delete(root);
  };
  // Fast acknowledgements may replace the optimistic DOM node. Move the same
  // animation to its replacement, without restarting its clock.
  const observer = new MutationObserver(() => {
    if (!page.isConnected) { cleanup(); return; }
    if (bubble!.isConnected) { trackLayout(); return; }
    const replacement = Array.from(page.querySelectorAll<HTMLElement>('.wd-thread > .wd-user-turn .wd-bubble.is-me, .wd-thread > .wd-user-turn .wd-location-card')).findLast(node => node.textContent === text);
    if (!replacement) { cleanup(); return; }
    bubble!.style.visibility = priorVisibility;
    bubble = replacement; priorVisibility = bubble.style.visibility;
    bubble.style.visibility = 'hidden'; trackLayout();
  });
  observer.observe(root, {childList:true, subtree:true});
  const nativeFinished = (event: Event) => {
    if ((event as CustomEvent<{id: string}>).detail?.id !== turn.dataset.messageId) return;
    nativeLanded = true;
    cleanup();
    // Keep the native final pixels until WebKit has presented the revealed DOM
    // bubble. A bridge acknowledgement alone does not guarantee a painted frame.
    requestAnimationFrame(() => requestAnimationFrame(() => nativeFlightMessage({cancel: true, token: entry.nativeFlightId})));
  };
  const nativeFallback = nativeFlight ? window.setTimeout(cleanup, 1_200) : undefined;
  if (nativeFlight) {
    window.addEventListener('decisionFeed:sendFlightFinished', nativeFinished);
    nativeFlightMessage({id: turn.dataset.messageId, token: entry.nativeFlightId, x: toX, y: toY, width: target.width, height: target.height, padding: paddingX, fontSize: number(css.fontSize), lineHeight: number(css.lineHeight), colors: Array.from(css.backgroundImage.matchAll(/rgba?\(([^)]+)\)/g), match => match[1].split(/[, ]+/).filter(Boolean).map(Number)).slice(0, 2), samples: sendMotionSamples});
  }
  entry.cancel = cleanup; active.set(root, cleanup);
  root.addEventListener('pointerdown', cleanup, {passive:true}); root.addEventListener('wheel', cleanup, {passive:true});
  document.addEventListener('visibilitychange', cleanup); reduced.addEventListener('change', cleanup);

}
