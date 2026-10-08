"use client";
import { useCallback, useLayoutEffect, useRef } from 'react';
import { postNativeMessage } from './native-bridge';

export type DetailsOrigin = { x: number; y: number; width: number; height: number };

/** Messages-style expansion from the tapped identity, driven by one reversible spring. */
export function useConversationDetailsMotion(origin: DetailsOrigin, onDismiss: () => void) {
  const sheetRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  const driver = useRef<{ close: () => void } | null>(null);
  const source = useRef(origin);
  const close = useCallback(() => driver.current?.close(), []);
  useLayoutEffect(() => {
    const sheet = sheetRef.current!, scrim = scrimRef.current!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let bounds = sheet.getBoundingClientRect();
    let from = source.current;
    const content = sheet.querySelector<HTMLElement>('.wd-details-scroll');
    let position = 0, velocity = 0, destination = 1, frame = 0, last = 0;
    let swipeRight = false;
    const radius = parseFloat(getComputedStyle(sheet).borderTopLeftRadius) || 0;
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    const paint = () => {
      const p = Math.max(0, Math.min(1, position));
      const x = swipeRight ? bounds.x + (1 - p) * bounds.width : mix(from.x, bounds.x, p), y = swipeRight ? bounds.y : mix(from.y, bounds.y, p);
      const width = swipeRight ? bounds.width : mix(from.width, bounds.width, p), height = swipeRight ? bounds.height : mix(from.height, bounds.height, p);
      const scale = width / bounds.width;
      const corner = swipeRight ? radius : mix(Math.min(from.width, from.height) / 2, radius, p);
      sheet.dataset.detailsProgress = p.toFixed(3);
      if (reduced) sheet.style.opacity = String(p);
      else {
        sheet.style.transformOrigin = '0 0';
        sheet.style.transform = `translate3d(${x - bounds.x}px,${y - bounds.y}px,0) scale(${scale})`;
        sheet.style.clipPath = `inset(0 0 ${Math.max(0, bounds.height - height / scale)}px 0 round ${corner / scale}px)`;
        sheet.style.opacity = String(swipeRight ? 1 : Math.min(1, p * 5));
        // Keep the panel a single clipped surface; no independent avatar flies
        // across the restored chat header during the final return to its pill.
        if (content) content.style.opacity = String(swipeRight ? 1 : Math.max(0, Math.min(1, (p - .2) / .5)));
      }
      scrim.style.opacity = String(p);
      postNativeMessage({ version: 1, action: 'sheetCoverage', payload: { x: reduced ? bounds.x : x, y: reduced ? bounds.y : y, width: reduced ? bounds.width : width, height: reduced ? bounds.height : height, viewportWidth: innerWidth, radius: corner, opacity: reduced ? p : swipeRight ? 1 : Math.min(1, p * 5), dimming: p * .1 } });
      window.dispatchEvent(new Event('decisionFeed:sheetLayout'));
    };
    const tick = (time: number) => {
      const dt = last ? Math.min((time - last) / 1000, .032) : 1 / 60; last = time;
      const omega = reduced ? 55 : 28;
      const displacement = position - destination, c = velocity + omega * displacement, decay = Math.exp(-omega * dt);
      position = destination + (displacement + c * dt) * decay;
      velocity = (velocity - omega * c * dt) * decay;
      if (Math.abs(position - destination) < .001 && Math.abs(velocity) < .025) {
        position = destination; velocity = 0;
        if (destination === 1) swipeRight = false;
        paint();
        if (destination === 0) dismiss.current();
      } else { paint(); frame = requestAnimationFrame(tick); }
    };
    const start = () => { cancelAnimationFrame(frame); last = 0; frame = requestAnimationFrame(tick); };
    driver.current = { close: () => {
      if (destination === 0 || document.querySelector('dialog[open]')) return;
      const currentSource = document.querySelector('.wd-taskbar-title > strong')?.getBoundingClientRect();
      if (currentSource) from = currentSource;
      destination = 0; start();
    } };
    let drag: { x: number; y: number; distance: number; time: number; speed: number; axis: 'right' | 'down' | null; scrollTop: number } | null = null;
    const begin = (x: number, y: number, target: EventTarget | null, time: number) => {
      if (position < .999 || destination !== 1 || document.querySelector('dialog[open]') ||
          !(target instanceof Element) || target.closest('button, a, input, textarea, select, video')) return;
      drag = { x, y, distance: 0, time, speed: 0, axis: null, scrollTop: content?.scrollTop ?? 0 };
    };
    const move = (x: number, y: number, time: number, event: Event) => {
      if (!drag) return;
      const dx = x - drag.x, dy = y - drag.y;
      if (!drag.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (dx > Math.abs(dy) * 1.2) drag.axis = 'right';
        else if (dy > 0 && dy > Math.abs(dx) * 1.2 && drag.scrollTop <= 0) drag.axis = 'down';
        else { drag = null; return; }
        swipeRight = drag.axis === 'right';
        cancelAnimationFrame(frame);
      }
      if (event.cancelable) event.preventDefault();
      const distance = Math.max(0, drag.axis === 'down' ? dy : dx);
      const elapsed = time - drag.time;
      if (elapsed > 0) drag.speed = (distance - drag.distance) / elapsed;
      drag.distance = distance; drag.time = time;
      position = 1 - Math.min(.95, distance / Math.max(240, bounds.width));
      velocity = -drag.speed * 1000 / Math.max(240, bounds.width);
      paint();
    };
    const finish = (cancelled = false) => {
      const state = drag; drag = null;
      if (!state?.axis) return;
      if (!cancelled && (state.distance > 80 || (state.distance > 24 && state.speed > .5))) driver.current?.close();
      else { destination = 1; velocity = 0; start(); }
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { finish(true); return; }
      const touch = event.touches[0]; begin(touch.clientX, touch.clientY, event.target, event.timeStamp);
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { finish(true); return; }
      const touch = event.touches[0]; move(touch.clientX, touch.clientY, event.timeStamp, event);
    };
    const touchEnd = () => finish();
    const touchCancel = () => finish(true);
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.button === 0) begin(event.clientX, event.clientY, event.target, event.timeStamp);
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      move(event.clientX, event.clientY, event.timeStamp, event);
      if (drag?.axis && !sheet.hasPointerCapture(event.pointerId)) sheet.setPointerCapture(event.pointerId);
    };
    const pointerUp = (event: PointerEvent) => { if (event.pointerType !== 'touch') finish(); };
    const pointerCancel = (event: PointerEvent) => { if (event.pointerType !== 'touch') finish(true); };
    sheet.addEventListener('touchstart', touchStart, { passive: true });
    sheet.addEventListener('touchmove', touchMove, { passive: false });
    sheet.addEventListener('touchend', touchEnd);
    sheet.addEventListener('touchcancel', touchCancel);
    sheet.addEventListener('pointerdown', pointerDown);
    sheet.addEventListener('pointermove', pointerMove);
    sheet.addEventListener('pointerup', pointerUp);
    sheet.addEventListener('pointercancel', pointerCancel);
    paint(); start();
    // Resize while settled must not keep stale device geometry applied.
    const resize = () => { if (position === 1) { sheet.style.transform = ''; sheet.style.clipPath = ''; bounds = sheet.getBoundingClientRect(); } };
    window.addEventListener('resize', resize);
    return () => {
      sheet.removeEventListener('touchstart', touchStart);
      sheet.removeEventListener('touchmove', touchMove);
      sheet.removeEventListener('touchend', touchEnd);
      sheet.removeEventListener('touchcancel', touchCancel);
      sheet.removeEventListener('pointerdown', pointerDown);
      sheet.removeEventListener('pointermove', pointerMove);
      sheet.removeEventListener('pointerup', pointerUp);
      sheet.removeEventListener('pointercancel', pointerCancel);
      cancelAnimationFrame(frame); driver.current = null;
      sheet.style.transform = ''; sheet.style.transformOrigin = ''; sheet.style.clipPath = ''; sheet.style.opacity = ''; scrim.style.opacity = '';
      delete sheet.dataset.detailsProgress;
      if (content) content.style.opacity = '';
      window.removeEventListener('resize', resize);
      postNativeMessage({ version: 1, action: 'sheetCoverage', payload: { ended: true } });
    };
  }, []);
  return { sheetRef, scrimRef, close };
}
