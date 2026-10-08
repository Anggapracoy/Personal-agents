"use client";
import { flushSync } from "react-dom";
import { useEffect, useRef, type RefObject } from "react";

/** Horizontal back gesture; vertical scrolling and sheet dismissal keep their own axis. */
export function useSettingsBackSwipe(ref: RefObject<HTMLElement | null>, page: string | undefined, onBack: () => void) {
  const back = useRef(onBack); back.current = onBack;
  useEffect(() => {
    const node = ref.current;
    if (!node || !page) return;
    let drag: { x: number; y: number; lastX: number; time: number; velocity: number; offset: number; active: boolean } | null = null;
    let animation: Animation | undefined;
    let finishing = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clear = () => { node.style.translate = ""; node.style.opacity = ""; };
    const start = (event: TouchEvent) => {
      if (finishing || event.touches.length !== 1 || (event.target as Element).closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      animation?.cancel(); clear();
      const touch = event.touches[0];
      drag = { x: touch.clientX, y: touch.clientY, lastX: touch.clientX, time: performance.now(), velocity: 0, offset: 0, active: false };
    };
    const move = (event: TouchEvent) => {
      if (!drag) return;
      if (event.touches.length !== 1) { finish(false); return; }
      const touch = event.touches[0], dx = touch.clientX - drag.x, dy = touch.clientY - drag.y;
      if (!drag.active) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (dx <= 0 || Math.abs(dy) >= dx) { drag = null; return; }
        drag.active = true;
      }
      event.preventDefault(); event.stopPropagation();
      const now = performance.now();
      drag.velocity = (touch.clientX - drag.lastX) / Math.max(1, now - drag.time);
      drag.lastX = touch.clientX; drag.time = now;
      drag.offset = Math.max(0, Math.min(node.clientWidth, dx));
      if (!reduced) node.style.translate = `${drag.offset}px 0`;
    };
    const finish = (commit: boolean) => {
      const state = drag; drag = null;
      if (!state?.active) return;
      finishing = true;
      const duration = reduced ? 100 : 220;
      animation = node.animate(reduced ? [{ opacity: 1 }, { opacity: commit ? 0 : 1 }] : [
        { translate: `${state.offset}px 0` }, { translate: `${commit ? node.clientWidth : 0}px 0` },
      ], { duration, easing: "cubic-bezier(.2,.75,.2,1)", fill: "forwards" });
      animation.onfinish = () => {
        // Commit while the outgoing page is still offscreen; no one-frame flash.
        if (commit) flushSync(() => back.current());
        animation?.cancel(); clear(); finishing = false;
      };
    };
    const end = () => finish(Boolean(drag && (drag.offset > node.clientWidth * .3 || (drag.offset > 40 && performance.now() - drag.time < 100 && drag.velocity > .5))));
    const cancel = () => finish(false);
    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", cancel);
    return () => {
      animation?.cancel(); clear();
      node.removeEventListener("touchstart", start); node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end); node.removeEventListener("touchcancel", cancel);
    };
  }, [page, ref]);
}
