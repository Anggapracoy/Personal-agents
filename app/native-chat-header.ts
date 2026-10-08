"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { postNativeMessage, type NativeWindow } from "./native-bridge";

/** Native material follows web layout; navigation uses the existing shared clock. */
export function useNativeChatHeader(header: RefObject<HTMLElement>, title: string, unreadCount: number, onBack: () => void, onBrowser?: () => void, activity: string | null = null, activitySymbol = "ellipsis.bubble", browserExiting = false, onDetails?: () => void) {
  const id = useId();
  const [native, setNative] = useState(false);
  const presentation = useRef({ title, activity, activitySymbol, unreadCount, browserExiting });
  presentation.current = { title, activity, activitySymbol, unreadCount, browserExiting };
  const republish = useRef<() => void>(() => {});
  const callbacks = useRef({ onBack, onBrowser, onDetails });
  callbacks.current = { onBack, onBrowser, onDetails };
  useEffect(() => {
    if (!(window as NativeWindow).__decisionFeedNativeChatHeader || !header.current) return;
    const element = header.current;
    const registrationId = crypto.randomUUID();
    let frame = 0;
    let last = "";
    let settleUntil = 0;
    const publish = () => {
      frame = 0;
      const layer = element.closest('.wd-front-layer');
      const matrix = layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform) : new DOMMatrixReadOnly();
      const shift = matrix.m41;
      const rect = (selector: string) => {
        const target = element.querySelector<HTMLElement>(selector);
        if (!target) return null;
        const r = target.getBoundingClientRect();
        // A vertical shear enlarges the axis-aligned bounding box, not the
        // control itself. Keep its transformed center without stretching glass.
        const shear = matrix.is2D && matrix.a === 1 && matrix.c === 0 && matrix.d === 1 ? Math.abs(matrix.b) * r.width : 0;
        const height = Math.max(0, r.height - shear);
        return { x: r.x - shift, y: r.y + shear / 2, width: r.width, height };
      };
      const payload = { id, registrationId, ...presentation.current, back: rect('.wd-chat-back'), label: rect('.wd-taskbar-title strong'), browser: rect('[aria-label="Open browser"]') };
      const encoded = JSON.stringify(payload);
      if (encoded !== last) { last = encoded; postNativeMessage({ version: 1, action: 'chatHeaderState', payload }); }
      if (performance.now() < settleUntil) frame = requestAnimationFrame(publish);
    };
    // WKWebView can finish safe-area, focus and rubber-band movement after its
    // final scroll event. Follow that settling motion instead of caching its
    // intermediate coordinates in the native overlay.
    const schedule = () => {
      settleUntil = performance.now() + 600;
      if (!frame) frame = requestAnimationFrame(publish);
    };
    republish.current = schedule;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; action: string; registrationId?: string }>).detail;
      if (detail?.id !== id || (detail.registrationId && detail.registrationId !== registrationId)) return;
      if (detail.action === 'ready') setNative(true);
      if (detail.action === 'details') callbacks.current.onDetails?.();
      if (detail.action === 'back') callbacks.current.onBack();
      if (detail.action === 'browser') callbacks.current.onBrowser?.();
    };
    window.addEventListener('decisionFeed:chatHeaderAction', receive);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const label = element.querySelector(".wd-taskbar-title strong");
    if (label) observer.observe(label);
    element.closest('.wd-task')?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('decisionFeed:sheetLayout', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    schedule();
    return () => {
      republish.current = () => {};
      cancelAnimationFrame(frame); observer.disconnect();
      element.closest('.wd-task')?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('decisionFeed:sheetLayout', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('decisionFeed:chatHeaderAction', receive);
      postNativeMessage({ version: 1, action: 'chatHeaderHide', payload: { id } });
    };
  }, [header, id]);
  useEffect(() => { republish.current(); }, [title, activity, activitySymbol, unreadCount, Boolean(onBrowser), browserExiting]);
  return native;
}
