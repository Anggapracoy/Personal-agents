"use client";
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { trackNativeLayout } from "./native-layout-tracker";
import { postNativeMessage, type NativeWindow } from "./native-bridge";

/** Native interactive glass on iPhone; accessible web control until native acknowledges it. */
export function NativeGlassButton({ symbol, text, visualSize, children, className = "wd-round", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { symbol: string; text?: string; visualSize?: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const presentation = useRef({ symbol, text, visualSize });
  presentation.current = { symbol, text, visualSize };
  const republish = useRef(() => {});
  useEffect(() => {
    if (!(window as NativeWindow).__decisionFeedNativeGlassButtons) return;
    const id = crypto.randomUUID();
    let previous = "";
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.id !== id) return;
      if (detail.action === "ready") setReady(true);
      if (detail.action === "press") ref.current?.click();
    };
    const publish = () => {
      const button = ref.current;
      if (button) {
        const rect = button.getBoundingClientRect();
        let opacity = 1;
        for (let node: HTMLElement | null = button.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          opacity *= Number(style.opacity);
          if (style.visibility === "hidden" || node.inert) opacity = 0;
        }
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (!hit || !button.contains(hit) || !button.checkVisibility()) opacity = 0;
        const width = Math.max(44, rect.width), height = Math.max(44, rect.height);
        const payload = { id, ...presentation.current, label: button.getAttribute("aria-label") || button.textContent || "Button", x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height, opacity, disabled: button.disabled };
        const serialized = JSON.stringify(payload);
        if (serialized !== previous) { previous = serialized; postNativeMessage({ version: 1, action: "glassButtonState", payload }); }
      }
    };
    window.addEventListener("decisionFeed:glassButtonAction", receive);
    const layout = trackNativeLayout(() => ref.current, publish);
    republish.current = layout.schedule;
    return () => {
      republish.current = () => {}; layout.dispose();
      window.removeEventListener("decisionFeed:glassButtonAction", receive);
      postNativeMessage({ version: 1, action: "glassButtonState", payload: { id, hidden: true } });
    };
  }, []);
  useEffect(() => { republish.current(); }, [symbol, text, visualSize]);
  return <button {...props} ref={ref} className={`${className} wd-glass-button`} data-native-glass={ready || undefined} aria-hidden={ready || undefined} tabIndex={ready ? -1 : props.tabIndex}>{children}</button>;
}
