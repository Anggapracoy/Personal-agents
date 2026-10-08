/** Compositor-only, critically damped navigation. Retains the departing pixels
 * until the destination is in place; interrupted motion starts where it is now. */
function freezeLinkImages(source: HTMLElement, copy: HTMLElement) {
  const originals = source.querySelectorAll<HTMLImageElement>('.wd-link-preview img');
  const clones = copy.querySelectorAll<HTMLImageElement>('.wd-link-preview img');
  originals.forEach((image, index) => {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;
    const clone = clones[index];
    if (!clone) return;
    const width = image.clientWidth, height = image.clientHeight;
    if (!width || !height) return;
    const canvas = document.createElement('canvas');
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    const crop = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / crop, sourceHeight = height / crop;
    try {
      context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    } catch { return; }
    canvas.style.cssText = 'display:block;width:100%;height:auto;aspect-ratio:1.91;';
    clone.replaceWith(canvas);
  });
}

export function createNavigationMotion(getRoot: () => HTMLElement | null, publish: (frame: { phase: string; incoming?: number; outgoing?: number; opacity?: number }) => void = () => {}) {
  let frame = 0;
  let ghost: HTMLElement | null = null;
  let position = 0;
  let velocity = 0;
  let previousTime = 0;
  let dragging = false;
  let restoredX: number | null = null;
  let dragOrigin = 0;
  let side = 1;
  const sides = new Map<string, number>();
  let nextKey = "";
  let currentKey = "";
  const parents = new Map<string, HTMLElement>();
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const front = () => getRoot()?.querySelector<HTMLElement>('.wd-front-layer:not(.wd-navigation-ghost)') ?? null;
  const home = () => getRoot()?.querySelector<HTMLElement>('.wd-home-layer:not(.wd-navigation-ghost)') ?? null;
  const translate = (node: HTMLElement | null, x: number) => { if (node) node.style.transform = `translate3d(${x}px,0,0)`; };
  const clear = (finished = false, resetSurfaces = true) => {
    if (finished) publish({ phase: "end" });
    cancelAnimationFrame(frame);
    ghost?.remove(); ghost = null;
    if (resetSurfaces) for (const node of [front(), home()]) { if (node) { node.style.transform = ''; node.style.opacity = ''; } }
  };
  const spring = (from: number, target: number, paint: (x: number) => void) => {
    cancelAnimationFrame(frame); position = from; previousTime = 0;
    const tick = (time: number) => {
      const dt = previousTime ? Math.min((time - previousTime) / 1000, .032) : 1 / 60;
      previousTime = time;
      // Exact solution of a critically damped spring, stable at any refresh rate.
      const displacement = position - target;
      const c = velocity + 24 * displacement;
      const decay = Math.exp(-24 * dt);
      position = target + (displacement + c * dt) * decay;
      velocity = (velocity - 24 * c * dt) * decay;
      paint(position);
      if (Math.abs(position - target) < .25 && Math.abs(velocity) < 5) { paint(target); clear(true); velocity = 0; }
      else frame = requestAnimationFrame(tick);
    };
    paint(from); frame = requestAnimationFrame(tick);
  };
  return {
    capture(destinationKey: string, sourceKey: string) {
      nextKey = destinationKey; currentKey = sourceKey;
      restoredX = ghost?.dataset.motionKey === destinationKey ? new DOMMatrixReadOnly(getComputedStyle(ghost).transform).m41 : null;
      const node = front() ?? home();
      const x = node ? new DOMMatrixReadOnly(getComputedStyle(node).transform).m41 : 0;
      const copy = node?.cloneNode(true) as HTMLElement | undefined;
      // Preserve the live parent position between capture and the React commit.
      // Resetting Home here exposes one unshifted frame behind a partial swipe.
      clear(false, false);
      if (copy) {
        freezeLinkImages(node!, copy);
        copy.classList.add('wd-navigation-ghost'); copy.dataset.motionKey = sourceKey;
        const originals = node!.querySelectorAll('*');
        copy.querySelectorAll('*').forEach((el, index) => { el.scrollTop = originals[index].scrollTop; el.scrollLeft = originals[index].scrollLeft; }); copy.inert = true; copy.setAttribute('aria-hidden', 'true');
        copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        getRoot()?.querySelector('.wd-main')?.append(copy); ghost = copy;
        copy.querySelectorAll('*').forEach((el, index) => { el.scrollTop = originals[index].scrollTop; el.scrollLeft = originals[index].scrollLeft; });
      }
      dragging = false;
      publish({ phase: "begin" });
      return x;
    },
    navigate(direction: 'push' | 'pop', from: number, entrySide: 1 | -1 = 1) {
      const width = getRoot()?.clientWidth ?? 1;
      const destination = front() ?? home();
      const departing = ghost;
      const motionSide = direction === 'push' ? entrySide : (sides.get(currentKey) ?? entrySide);
      if (direction === 'push') sides.set(nextKey, motionSide);
      side = sides.get(nextKey) ?? 1;
      if (direction === 'push' && departing) parents.set(nextKey, departing.cloneNode(true) as HTMLElement);
      if (direction === 'pop') parents.delete(currentKey);
      currentKey = nextKey;
      if (reduced()) {
        position = 0; velocity = 0; translate(destination, 0); translate(departing, 0);
        spring(0, 1, p => { publish({ phase: "frame", incoming: 0, outgoing: 0, opacity: p }); if (destination) destination.style.opacity = String(p); if (departing) departing.style.opacity = String(1-p); });
        return;
      }
      if (direction === 'push') {
        velocity = 0;
        const start = restoredX ?? motionSide * width;
        spring(start, 0, x => { const outgoing = from + (-motionSide*width*.28-from)*(1-(start === 0 ? 0 : x/start)); translate(destination, x); translate(departing, outgoing); publish({ phase: 'frame', incoming: x, outgoing }); if (departing) departing.style.zIndex = '0'; });
      } else {
        spring(from, motionSide * width, x => { const incoming = -.28*(motionSide*width-x); translate(departing, x); translate(destination, incoming); publish({ phase: 'frame', incoming, outgoing: x }); });
      }
    },
    dragPush(progress: number) {
      cancelAnimationFrame(frame);
      const width = getRoot()?.clientWidth ?? 1;
      const next = side * width * (1 - Math.min(1, Math.max(0, progress)));
      const time = performance.now();
      if (previousTime && time > previousTime) velocity = Math.max(-2400, Math.min(2400, (next - position) / ((time - previousTime) / 1000)));
      previousTime = time; position = next;
      if (reduced()) { translate(front(), 0); if (front()) front()!.style.opacity = String(progress); }
      else translate(front(), next);
      const outgoing = -side * width * .28 * progress;
      translate(ghost ?? home(), reduced() ? 0 : outgoing);
      publish({ phase: 'frame', incoming: reduced() ? 0 : next, outgoing: reduced() ? 0 : outgoing, ...(reduced() ? { opacity: progress } : {}) });
    },
    finishPush() {
      const width = getRoot()?.clientWidth ?? 1;
      if (reduced()) {
        velocity = 0;
        spring(Number(front()?.style.opacity ?? 0), 1, p => { if (front()) front()!.style.opacity = String(p); publish({ phase: 'frame', incoming: 0, outgoing: 0, opacity: p }); });
      } else spring(position, 0, x => {
        const outgoing = -.28 * (side * width - x);
        translate(front(), x); translate(ghost ?? home(), outgoing);
        publish({ phase: 'frame', incoming: x, outgoing });
      });
    },
    drag(progress: number) {
      if (reduced()) return;
      if (!dragging) {
        const current = front();
        position = current ? new DOMMatrixReadOnly(getComputedStyle(current).transform).m41 : 0;
        cancelAnimationFrame(frame);
        // A fast back gesture can interrupt the opening spring while its Home
        // snapshot is still mounted. Transfer its presentation to live Home
        // before removing it, so capture/pop never reveals Home at x = 0.
        if (ghost?.classList.contains('wd-home-layer') && home()) {
          const retainedHome = home()!;
          retainedHome.style.transform = ghost.style.transform;
          retainedHome.style.opacity = ghost.style.opacity;
          ghost.remove(); ghost = null;
        }
        const parent = parents.get(currentKey);
        // Home stays mounted with its current scroll/read state. A cloned Home
        // loses scroll offsets and would visibly switch back to live Home on pop.
        if (!ghost && parent && !parent.classList.contains('wd-home-layer')) {
          ghost = parent.cloneNode(true) as HTMLElement;
          ghost.style.zIndex = '0'; getRoot()?.querySelector('.wd-main')?.append(ghost);
        }
        dragOrigin = position; dragging = true; previousTime = performance.now();
      }
      const next = side * Math.min(getRoot()?.clientWidth ?? 1, side * dragOrigin + progress * (getRoot()?.clientWidth ?? 1));
      const time = performance.now();
      if (time > previousTime) velocity = Math.max(-2400, Math.min(2400, (next-position) / ((time-previousTime)/1000)));
      previousTime = time; position = next;
      publish({ phase: 'drag', incoming: position, outgoing: -.28*(side*(getRoot()?.clientWidth ?? 1)-position) });
      translate(front(), position); translate(ghost ?? home(), -.28*(side*(getRoot()?.clientWidth ?? 1)-position));
    },
    cancel() {
      if (!dragging) return;
      dragging = false;
      const width = getRoot()?.clientWidth ?? 1;
      spring(position, 0, x => { publish({ phase: 'drag', incoming: x, outgoing: -.28*(side*width-x) }); translate(front(), x); translate(ghost ?? home(), -.28*(side*width-x)); });
    },
    dispose: () => clear(true),
  };
}
