"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { isTopSheet } from "./sheet-coverage-stack";
import { trackNativeLayout } from "./native-layout-tracker";
import { postNativeMessage, type NativeWindow } from "./native-bridge";

/** Shared native glass X for modal sheets. Retains the existing wrapper protocol. */
export function useNativeSheetClose(sheetRef: RefObject<HTMLElement | null>, onClose: () => void, label: string) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [nativeClose, setNativeClose] = useState(false);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!(window as NativeWindow).__decisionFeedNativeBrowserClose) return;
    const id = crypto.randomUUID();
    let previous = "";
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.id !== id) return;
      if (detail.action === "ready") setNativeClose(true);
      if (detail.action === "close" && sheetRef.current && isTopSheet(sheetRef.current)) close.current();
    };
    const publish = () => {
      const button = closeRef.current, sheet = sheetRef.current;
      if (button && sheet) {
        const rect = button.getBoundingClientRect();
        let opacity = 1;
        for (let node: HTMLElement | null = button.parentElement; node; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
          if (node === sheet) break;
        }
        if(!isTopSheet(sheet) || button.closest("[inert]")) opacity=0;
        const payload = { id, label, x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity };
        const serialized = JSON.stringify(payload);
        if (serialized !== previous) { previous = serialized; postNativeMessage({ version: 1, action: "browserCloseState", payload }); }
      }
    };
    window.addEventListener("decisionFeed:browserCloseAction", receive);
    const layout = trackNativeLayout(() => closeRef.current, publish);
    return () => {
      layout.dispose();
      window.removeEventListener("decisionFeed:browserCloseAction", receive);
      postNativeMessage({ version: 1, action: "browserCloseState", payload: { id, hidden: true } });
    };
  }, [sheetRef, label]);
  return { closeRef, nativeClose };
}
