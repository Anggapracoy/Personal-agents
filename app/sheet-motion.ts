"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import { isTopSheet, registerSheetCoverage, updateSheetCoverage } from "./sheet-coverage-stack";

/** Keep dismissal responsive, including when it interrupts the entrance. */
export function useSheetMotion(onDismiss: () => void, { contentSwipe = false, presented = true }: { contentSwipe?: boolean; presented?: boolean } = {}) {
  const sheetRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const animations = useRef<Animation[]>([]);
  const closing = useRef(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; active: boolean; offset: number; lastY: number; lastTime: number; velocity: number } | null>(null);
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;

  const frame = useRef(0);
  const automatic = useRef(true);
  const trackCoverage = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const publish = () => {
      const sheet = sheetRef.current, scrim = scrimRef.current;
      if (!sheet || !scrim) return;
      window.dispatchEvent(new Event("decisionFeed:sheetLayout"));
      const rect = sheet.getBoundingClientRect();
      const style = getComputedStyle(sheet);
      const header = sheet.classList.contains('wd-settings-sheet') ? document.querySelector<HTMLElement>('.wd-home .wd-topbar') : null;
      // Finish fading the whole header before the sheet edge reaches its circles.
      // Direct dragging keeps the existing physical occlusion instead.
      const headerOpacity = header && automatic.current ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 1 - Number(style.opacity)
        : Math.max(0, Math.min(1, (rect.top - header.getBoundingClientRect().bottom - 12) / 44)) : 1;
      if (header) header.style.opacity = String(headerOpacity);
      updateSheetCoverage(sheet, {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, radius: parseFloat(style.borderTopLeftRadius) || 0,
        opacity: Number(style.opacity), dimming: Number(getComputedStyle(scrim).opacity) * .4,
        headerOpacity,
      });
      if (animations.current.some(animation => animation.playState === "running")) frame.current = requestAnimationFrame(publish);
    };
    publish();
  }, []);

  useLayoutEffect(() => {
    if(!presented || !sheetRef.current || !scrimRef.current) return;
    const sheet=sheetRef.current;
    const unregister=registerSheetCoverage(sheet,trackCoverage);
    closing.current = false;
    automatic.current = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const options = { duration: reduced ? 100 : 320, easing: "cubic-bezier(.2,.75,.2,1)", fill: "both" as const };
    animations.current = [
      sheetRef.current!.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], options),
      scrimRef.current!.animate([{ opacity: 0 }, { opacity: 1 }], options),
    ];
    trackCoverage();
    window.addEventListener("resize", trackCoverage);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("resize", trackCoverage);
      animations.current.forEach(animation => animation.cancel());
      if(sheet.classList.contains('wd-settings-sheet')) document.querySelector<HTMLElement>('.wd-home .wd-topbar')?.style.removeProperty('opacity');
      unregister();
    };
  }, [trackCoverage, presented]);

  const close = useCallback(() => {
    if (closing.current || (sheetRef.current && !isTopSheet(sheetRef.current))) return;
    // A nested modal gets the first dismissal, including native close requests.
    if (sheetRef.current && !sheetRef.current.dispatchEvent(new Event("dash:sheetCloseRequest", { cancelable: true }))) return;
    closing.current = true;
    automatic.current = true;
    drag.current = null;
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (!sheet || !scrim) { dismiss.current(); return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = getComputedStyle(sheet);
    const start = reduced ? { opacity: style.opacity } : { transform: style.transform };
    const scrimOpacity = getComputedStyle(scrim).opacity;
    animations.current.forEach(animation => animation.cancel());
    const options = { duration: reduced ? 100 : 280, easing: "cubic-bezier(.2,.75,.2,1)", fill: "both" as const };
    const motion = sheet.animate([start, reduced ? { opacity: 0 } : { transform: "translateY(100%)" }], options);
    animations.current = [motion, scrim.animate([{ opacity: scrimOpacity }, { opacity: 0 }], options)];
    trackCoverage();
    void motion.finished.then(() => dismiss.current()).catch(() => undefined);
  }, [trackCoverage]);

  const settleDrag = () => {
    const sheet = sheetRef.current, scrim = scrimRef.current;
    if (!sheet || !scrim) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const options = { duration: reduced ? 100 : 240, easing: "cubic-bezier(.2,.75,.2,1)", fill: "both" as const };
    animations.current = [sheet.animate([{ transform: getComputedStyle(sheet).transform }, { transform: "translateY(0)" }], options),
      scrim.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: 1 }], options)];
    trackCoverage();
  };
  type DragPoint = { pointerId: number; clientX: number; clientY: number; timeStamp: number };
  const finishDrag = (event: DragPoint, cancelled = false) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    const dy = event.clientY - state.startY;
    // Some touch sequences coalesce movement into the release. Keep the same
    // downward-distance rule even when no intermediate move was delivered.
    if (!state.active && (cancelled || dy < 8 || Math.abs(event.clientX - state.startX) > dy)) return;
    const distance = Math.max(0, state.offset + event.clientY - state.startY);
    const height = sheetRef.current?.getBoundingClientRect().height ?? 800;
    if (!cancelled && (distance > height * .18 || (distance > 24 && state.velocity > .5))) close();
    else settleDrag();
  };
  const moveDrag = (event: DragPoint, capture?: () => void) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || !sheetRef.current || !scrimRef.current) return;
    if (!state.active) {
      const dx = event.clientX - state.startX, dy = event.clientY - state.startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (dy <= 0 || Math.abs(dx) > dy) { drag.current = null; return; }
      const sheet = sheetRef.current, scrim = scrimRef.current;
      state.offset = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
      const opacity = getComputedStyle(scrim).opacity;
      animations.current.forEach(animation => animation.cancel());
      sheet.style.transform = `translateY(${state.offset}px)`;
      scrim.style.opacity = opacity;
      state.active = true;
      automatic.current = false;
      capture?.();
    }
    const elapsed = event.timeStamp - state.lastTime;
    if (elapsed > 0) state.velocity = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY; state.lastTime = event.timeStamp;
    const distance = Math.max(0, state.offset + event.clientY - state.startY);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) sheetRef.current.style.transform = `translateY(${distance}px)`;
    scrimRef.current.style.opacity = String(Math.max(0, 1 - distance / sheetRef.current.getBoundingClientRect().height));
    trackCoverage();
  };
  const dragHandleProps = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (contentSwipe && event.pointerType === "touch") return;
      if (!event.isPrimary) {
        const wasActive = drag.current?.active;
        drag.current = null;
        if (wasActive) settleDrag();
        return;
      }
      if (closing.current || drag.current || event.button !== 0 || (event.target instanceof Element && event.target.closest("button, a, input, select, textarea"))) return;
      const sheet = sheetRef.current, scrim = scrimRef.current;
      if (!sheet || !scrim) return;
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false,
        offset: 0, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (contentSwipe && event.pointerType === "touch") return;
      moveDrag(event, () => event.currentTarget.setPointerCapture(event.pointerId));
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => finishDrag(event),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finishDrag(event, true),
    // Capture transfers from the touched image to the sheet. The descendant's
    // lostpointercapture bubbles here and must not cancel the new owner.
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => { if (event.target === event.currentTarget) finishDrag(event, true); },
  };

  // Touch listeners can claim a downward gesture at the scroll boundary without
  // disabling native vertical scrolling with touch-action:none on the page.
  const touchHandlers = useRef({ moveDrag, finishDrag });
  touchHandlers.current = { moveDrag, finishDrag };
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!contentSwipe || !sheet) return;
    let last: DragPoint | null = null;
    let scroller: HTMLElement | null = null;
    let suppressClick = false;
    const point = (touch: Touch, timeStamp: number): DragPoint => ({ pointerId: -1, clientX: touch.clientX, clientY: touch.clientY, timeStamp });
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      suppressClick = false;
      const target = event.target as Element;
      if (closing.current || drag.current || target.closest('input, select, textarea, [contenteditable="true"], [inert]')) return;
      scroller = target.closest(".wd-taskbar") ? null : target.closest<HTMLElement>(".wd-screen");
      if (scroller && scroller.scrollTop > 0) return;
      last = point(event.touches[0], event.timeStamp);
      drag.current = { pointerId: -1, startX: last.clientX, startY: last.clientY, active: false,
        offset: 0, lastY: last.clientY, lastTime: last.timeStamp, velocity: 0 };
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      if (drag.current?.pointerId !== -1) return;
      if (!drag.current.active && scroller && scroller.scrollTop > 0) { drag.current = null; return; }
      last = point(event.touches[0], event.timeStamp);
      touchHandlers.current.moveDrag(last);
      if (drag.current?.active) { suppressClick = true; event.preventDefault(); event.stopPropagation(); }
    };
    const end = (event: TouchEvent) => {
      if (drag.current?.active) event.preventDefault();
      if (last) touchHandlers.current.finishDrag(last); last = null;
    };
    const click = (event: MouseEvent) => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } };
    const pointer = () => { suppressClick = false; };
    const cancel = () => { if (last) touchHandlers.current.finishDrag(last, true); last = null; };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end, { passive: false });
    sheet.addEventListener("click", click, true);
    sheet.addEventListener("pointerdown", pointer);
    sheet.addEventListener("touchcancel", cancel);
    return () => {
      sheet.removeEventListener("touchstart", start); sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end); sheet.removeEventListener("touchcancel", cancel);
      sheet.removeEventListener("click", click, true); sheet.removeEventListener("pointerdown", pointer);
    };
  }, [contentSwipe]);

  return { sheetRef, scrimRef, close, dragHandleProps };
}
