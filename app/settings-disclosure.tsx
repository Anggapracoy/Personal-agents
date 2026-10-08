"use client";

import { useEffect, useRef, type ComponentProps } from "react";

/** Keep native disclosure semantics while animating both opening and closing. */
export function SettingsDisclosure(props: ComponentProps<"details">) {
  const ref = useRef<HTMLDetailsElement>(null);
  const animation = useRef<Animation | null>(null);
  const expanded = useRef(false);
  useEffect(() => () => animation.current?.cancel(), []);
  return <details {...props} ref={ref} onClick={(event) => {
    props.onClick?.(event);
    const details = ref.current;
    const summary = details?.querySelector("summary");
    if (event.defaultPrevented || !details || !summary || !summary.contains(event.target as Node)) return;
    event.preventDefault();
    const start = details.getBoundingClientRect().height;
    expanded.current = !expanded.current;
    details.dataset.expanded = String(expanded.current);
    animation.current?.cancel();
    animation.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      details.open = expanded.current;
      details.style.overflow = "";
      return;
    }
    details.open = true;
    const end = expanded.current ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height + (details.offsetHeight - details.clientHeight);
    details.style.overflow = "hidden";
    const current = details.animate({ height: [`${start}px`, `${end}px`] }, { duration: 220, easing: "cubic-bezier(.22, 1, .36, 1)" });
    animation.current = current;
    current.onfinish = () => {
      details.open = expanded.current;
      details.style.overflow = "";
      animation.current = null;
    };
  }} />;
}
