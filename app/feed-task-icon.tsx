"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { TaskIcon } from "./task-icon";

/** Animate only visible feed avatars; shared artwork stays usable in server renders. */
export function FeedTaskIcon(props: ComponentProps<typeof TaskIcon>) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    let inView = false;
    const update = () => setVisible(inView && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    observer.observe(root.current);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  return <TaskIcon {...props} animated iconRef={root} idleVisible={visible} className="is-feed-idle" />;
}
