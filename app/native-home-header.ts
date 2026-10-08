"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { postNativeMessage, type NativeWindow } from "./native-bridge";

/** Web owns layout/actions; iOS supplies the same interactive glass as the composer. */
export function useNativeHomeHeader(header: RefObject<HTMLElement>, active: boolean, archived: boolean, searching: boolean, archivedCount: number, image?: string | null, initial = "") {
  const id = useId();
  const [native, setNative] = useState(false);
  const [nativeAvatar, setNativeAvatar] = useState(false);
  const presentation = useRef({ archived, searching, archivedCount, avatarImage: image ?? "", avatarInitial: initial });
  presentation.current = { archived, searching, archivedCount, avatarImage: image ?? "", avatarInitial: initial };
  const republish = useRef(() => {});
  useEffect(() => {
    const element = header.current;
    if (!(window as NativeWindow).__decisionFeedNativeHomeHeader || !element || !active) return;
    const registrationId = crypto.randomUUID();
    let frame = 0;
    let last = "";
    const publish = () => {
      frame = 0;
      const layer = element.closest('.wd-front-layer, .wd-home-layer');
      const shift = layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform).m41 : 0;
      const hasAvatar = Boolean((window as NativeWindow).__decisionFeedNativeHomeAvatar);
      const buttons = [...element.querySelectorAll<HTMLButtonElement>(hasAvatar ? '[data-home-action], [data-home-profile]' : '[data-home-action]')].map(button => {
        const rect = button.getBoundingClientRect();
        return { action: button.dataset.homeAction || "you", label: button.getAttribute('aria-label'), x: rect.x - shift, y: rect.y, width: rect.width, height: rect.height };
      });
      const payload = { id, registrationId, ...presentation.current, buttons };
      const encoded = JSON.stringify(payload);
      if (encoded !== last) { last = encoded; postNativeMessage({ version: 1, action: 'homeHeaderState', payload }); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(publish); };
    republish.current = schedule;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.id !== id || (detail.registrationId && detail.registrationId !== registrationId)) return;
      if (detail.action === 'ready') { setNative(true); setNativeAvatar(Boolean((window as NativeWindow).__decisionFeedNativeHomeAvatar)); }
      if (detail.action === 'you') element.querySelector<HTMLButtonElement>('[data-home-profile]')?.click();
      if (['back', 'archive', 'search'].includes(detail.action)) {
        element.querySelector<HTMLButtonElement>(`[data-home-action="${detail.action}"]`)?.click();
      }
    };
    window.addEventListener('decisionFeed:homeHeaderAction', receive);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    // Safe-area changes move the fixed-height header without resizing it.
    // A non-layout probe observes the inset itself, even when Home also keeps
    // the same content-box dimensions.
    const home = element.closest('.wd-home');
    const insetProbe = document.createElement('span');
    insetProbe.setAttribute('aria-hidden', 'true');
    insetProbe.style.cssText = 'position:absolute;width:0;height:var(--safe-top);visibility:hidden;pointer-events:none;';
    (home ?? element).appendChild(insetProbe);
    observer.observe(insetProbe);
    home?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    publish();
    return () => {
      republish.current = () => {};
      cancelAnimationFrame(frame); observer.disconnect(); insetProbe.remove();
      home?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.removeEventListener('decisionFeed:homeHeaderAction', receive);
      postNativeMessage({ version: 1, action: 'homeHeaderState', payload: { id, hidden: true } });
    };
  }, [header, id, active]);
  useEffect(() => { republish.current(); }, [archived, searching, archivedCount, image, initial]);
  return { native, nativeAvatar };
}
