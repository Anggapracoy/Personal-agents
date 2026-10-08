"use client";
// Full-screen browser observation and takeover share one quiet viewer.
import { useEffect, useRef, useState } from "react";
import { useNativeSheetClose } from "./native-sheet-close";
import { useSheetMotion } from "./sheet-motion";
import type { RunningTask as CurrentRunningTask } from "../lib/types";
export type BrowserFrame = { id: string; label: string; url?: string };
export type RunningTask = Pick<CurrentRunningTask, "title" | "subtitle" | "status" | "approvalKind" | "browserUsed" | "estimate"> & {
  runId: string;
  browserFrames: BrowserFrame[];
  steps: Array<{ label: string; detail: string; status: "done" | "active" | "approval" | "failed" }>;
};
function BrowserLoading({ reconnecting = false }: { reconnecting?: boolean }) {
  return <div className="browser-frame-loading browser-frame-loading-overlay" role="status"><span className="wd-spinner" aria-hidden="true" /><span>{reconnecting ? "Reconnecting…" : "Connecting to browser…"}</span></div>;
}

/** Keep the loading surface above the initially blank document/image. */
function BrowserSurface({ src, title, image = false, active = false }: { src: string; title: string; image?: boolean; active?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (image || !active || !loaded || ended || failed) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const check = async () => {
      if (document.visibilityState === "hidden") { timer = setTimeout(check, 5000); return; }
      try {
        const response = await fetch(`${src}&health=1`, { cache: "no-store", signal: abort.signal });
        const health = response.ok ? await response.json() : null;
        if (stopped) return;
        if (health?.state === "reconnect" && src.includes("control=1")) {
          if (attempt >= 3) setFailed(true);
          else { setLoaded(false); setAttempt(value => value + 1); }
          return;
        }
        // The passive stream manages its own reconnects. A missing/expired
        // mint during navigation must not permanently cover that recovering view.
        if (health?.state === "unavailable" && src.includes("control=1")) { setFailed(true); return; }
        if (health?.state === "inactive" || (health?.state === "mode_changed" && !src.includes("control=1"))) { setEnded(true); return; }
      } catch { /* Network failures do not prove the stream ended. */ }
      if (!stopped) timer = setTimeout(check, 5000);
    };
    timer = setTimeout(check, 1000);
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [src, image, active, loaded, ended, failed, attempt]);
  return <>
    {image ? <img draggable={false} src={src} alt={title} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /> : <iframe key={attempt} src={attempt ? `${src}&reconnect=${attempt}` : src} title={title} allow="clipboard-read; clipboard-write" aria-busy={!loaded} onLoad={() => setLoaded(true)} />}
    {ended ? <div className="browser-frame-unavailable browser-frame-loading-overlay" role="status">Live view ended. Return to the conversation.</div> : failed ? <div className="browser-frame-unavailable browser-frame-loading-overlay" role="status">{image ? "This browser frame couldn’t load." : <>Live view disconnected.<button type="button" onClick={() => { setFailed(false); setLoaded(false); setAttempt(value => value + 1); }}>Reconnect</button></>}</div> : !loaded && <BrowserLoading reconnecting={attempt > 0} />}
  </>;
}

export function CloudBrowserPanel({ task, controlRequested, initialFrameId, liveAvailable, closeForAttention = false, onControlModeChange, onResumeTask, onClose: onDismiss }: {
  task: RunningTask;
  controlRequested: boolean;
  initialFrameId?: string | null;
  liveAvailable: boolean;
  closeForAttention?: boolean;
  onControlModeChange: (enabled: boolean) => void;
  onResumeTask: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { sheetRef, scrimRef, close: onClose, dragHandleProps } = useSheetMotion(onDismiss);
  useEffect(() => { if (closeForAttention) onClose(); }, [closeForAttention, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { closeRef, nativeClose } = useNativeSheetClose(sheetRef, onClose, "Hide browser");
  const canTakeOver = task.status === "running" || (task.status === "needs_approval" && task.approvalKind === "takeover");
  const [controlSelected, setControlEnabled] = useState(controlRequested && canTakeOver);
  const controlEnabled = controlSelected && canTakeOver;
  useEffect(() => {
    if (!canTakeOver && controlSelected) { setControlEnabled(false); onControlModeChange(false); }
  }, [canTakeOver, controlSelected, onControlModeChange]);
  const [continuing, setContinuing] = useState(false);
  const [browserZoom, setBrowserZoom] = useState(1);
  const [browserZoomOrigin, setBrowserZoomOrigin] = useState("50% 50%");
  const [browserPan, setBrowserPan] = useState({ x: 0, y: 0 });
  const browserFrameRef = useRef<HTMLDivElement | null>(null);
  const browserZoomRef = useRef(1);
  const browserZoomOriginRef = useRef({ x: .5, y: .5 });
  const browserPanRef = useRef({ x: 0, y: 0 });
  const resetBrowserZoom = () => {
    browserZoomRef.current = 1;
    browserZoomOriginRef.current = { x: .5, y: .5 };
    browserPanRef.current = { x: 0, y: 0 };
    setBrowserZoom(1);
    setBrowserZoomOrigin("50% 50%");
    setBrowserPan({ x: 0, y: 0 });
  };
  const frames = task.browserFrames ?? [];
  const [showRequestedFrame, setShowRequestedFrame] = useState(Boolean(initialFrameId));
  const selectedFrame = showRequestedFrame
    ? frames.find(frame => frame.id === initialFrameId) ?? frames.at(-1) ?? null
    : liveAvailable ? null : frames.at(-1) ?? null;
  useEffect(() => {
    const node = browserFrameRef.current;
    if (!node) return;
    let pinch: { distance: number; scale: number } | null = null;
    let pan: { clientX: number; clientY: number; x: number; y: number } | null = null;
    const distance = (touches: TouchList) => Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
    const clampPan = (x: number, y: number, zoom: number) => {
      const bounds = node.getBoundingClientRect();
      const origin = browserZoomOriginRef.current;
      return {
        x: Math.max(-(1 - origin.x) * bounds.width * (zoom - 1), Math.min(origin.x * bounds.width * (zoom - 1), x)),
        y: Math.max(-(1 - origin.y) * bounds.height * (zoom - 1), Math.min(origin.y * bounds.height * (zoom - 1), y)),
      };
    };
    const isBrowserGestureControl = (target: EventTarget | null) => target instanceof Element
      && Boolean(target.closest("button, a, input, select, textarea, summary, [role='button']"));
    const start = (event: TouchEvent) => {
      if (isBrowserGestureControl(event.target)) {
        pinch = null;
        pan = null;
        return;
      }
      if (event.touches.length === 2) {
        event.preventDefault();
        const bounds = node.getBoundingClientRect();
        const origin = {
          x: Math.max(0, Math.min(1, ((event.touches[0]!.clientX + event.touches[1]!.clientX) / 2 - bounds.left) / bounds.width)),
          y: Math.max(0, Math.min(1, ((event.touches[0]!.clientY + event.touches[1]!.clientY) / 2 - bounds.top) / bounds.height)),
        };
        browserZoomOriginRef.current = origin;
        setBrowserZoomOrigin(`${origin.x * 100}% ${origin.y * 100}%`);
        pinch = { distance: distance(event.touches), scale: browserZoomRef.current };
        pan = null;
      } else if (event.touches.length === 1 && browserZoomRef.current > 1.01) {
        event.preventDefault();
        pan = { clientX: event.touches[0]!.clientX, clientY: event.touches[0]!.clientY, ...browserPanRef.current };
      }
    };
    const move = (event: TouchEvent) => {
      if (pinch && event.touches.length === 2) {
        event.preventDefault();
        const nextZoom = Math.max(1, Math.min(4, pinch.scale * distance(event.touches) / pinch.distance));
        const nextPan = nextZoom <= 1.01 ? { x: 0, y: 0 } : clampPan(browserPanRef.current.x, browserPanRef.current.y, nextZoom);
        browserZoomRef.current = nextZoom;
        browserPanRef.current = nextPan;
        setBrowserZoom(nextZoom);
        setBrowserPan(nextPan);
      } else if (pan && event.touches.length === 1 && browserZoomRef.current > 1.01) {
        event.preventDefault();
        const nextPan = clampPan(pan.x + event.touches[0]!.clientX - pan.clientX, pan.y + event.touches[0]!.clientY - pan.clientY, browserZoomRef.current);
        browserPanRef.current = nextPan;
        setBrowserPan(nextPan);
      }
    };
    const end = (event: TouchEvent) => { if (event.touches.length < 2) pinch = null; if (event.touches.length !== 1) pan = null; };
    node.addEventListener("touchstart", start, { passive: false });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    return () => {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    };
  }, []);
  useEffect(() => {
    browserZoomRef.current = 1;
    browserZoomOriginRef.current = { x: .5, y: .5 };
    browserPanRef.current = { x: 0, y: 0 };
    setBrowserZoom(1);
    setBrowserZoomOrigin("50% 50%");
    setBrowserPan({ x: 0, y: 0 });
  }, [task.runId]);
  useEffect(() => {
    if (!controlRequested || !canTakeOver) return;
    setShowRequestedFrame(false);
    browserZoomRef.current = 1;
    browserZoomOriginRef.current = { x: .5, y: .5 };
    browserPanRef.current = { x: 0, y: 0 };
    setBrowserZoom(1);
    setBrowserZoomOrigin("50% 50%");
    setBrowserPan({ x: 0, y: 0 });
    setControlEnabled(true);
  }, [controlRequested, frames.length, canTakeOver]);
  const browserSrc = `/api/runs/${task.runId}/browser?control=${controlEnabled ? "1" : "0"}`;
  const toggleTakeover = () => {
    if (!controlEnabled) {
      if (!canTakeOver) return;
      if (!window.confirm("Take over the browser?\n\nDash will pause while you use the browser. Tap Continue to hand control back.")) return;
      setShowRequestedFrame(false);
      browserZoomRef.current = 1;
      browserZoomOriginRef.current = { x: .5, y: .5 };
      browserPanRef.current = { x: 0, y: 0 };
      setBrowserZoom(1);
      setBrowserZoomOrigin("50% 50%");
      setBrowserPan({ x: 0, y: 0 });
    }
    setControlEnabled((enabled) => {
      const next = !enabled;
      onControlModeChange(next);
      return next;
    });
  };
  const finishTakeover = async () => {
    if (continuing) return;
    setContinuing(true);
    try {
      if (!await onResumeTask()) return;
      setControlEnabled(false);
      onControlModeChange(false);
    } finally {
      setContinuing(false);
    }
  };
  const zoomStyle = { "--browser-frame-zoom": browserZoom, "--browser-frame-zoom-origin": browserZoomOrigin, "--browser-frame-pan-x": `${browserPan.x}px`, "--browser-frame-pan-y": `${browserPan.y}px` } as React.CSSProperties;
  return (
    <>
    <button ref={scrimRef} className="browser-sheet-backdrop" onClick={onClose} aria-label="Hide browser" />
    <aside {...dragHandleProps} onPointerDown={event => {
      const target = event.target as Element;
      if (target.closest(".cloud-browser-frame") && (controlEnabled || browserZoomRef.current > 1.01)) return;
      dragHandleProps.onPointerDown(event);
    }} ref={sheetRef} className={`cloud-browser-panel ${controlEnabled ? " browser-control-enabled" : ""}`} role="dialog" aria-modal="true" aria-label={`Live view for ${task.title}`}>
      <header>
        <button ref={closeRef} style={nativeClose ? { visibility: "hidden" } : undefined} className="wd-round browser-sheet-close" onClick={onClose} aria-label="Hide browser"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button>
        <div className="browser-location"><strong title={task.title}>{task.title}</strong></div>
        <div className="browser-window-controls">
          <button className="browser-external-takeover" type="button" onClick={controlEnabled ? finishTakeover : toggleTakeover} aria-pressed={controlEnabled} disabled={continuing || !canTakeOver}>{controlEnabled ? continuing ? "Continuing…" : "Continue" : "Take over"}</button>
        </div>
      </header>
      <div className={`cloud-browser-frame browser-fit-page ${controlEnabled ? "browser-frame-control" : `browser-frame-zoomable${browserZoom > 1.01 ? " browser-frame-pannable" : ""}`}`} ref={browserFrameRef} style={zoomStyle}>
        {!controlEnabled && !liveAvailable && frames.length === 0 ? <div className="browser-frame-unavailable">No browser frames were recorded.</div> : controlEnabled ? <BrowserSurface key={browserSrc} src={browserSrc} active={task.status === "running" || task.status === "needs_approval"} title={`Control browser for ${task.title}`} /> : selectedFrame ? <BrowserSurface key={`${task.runId}:${selectedFrame.id}`} image src={`/api/runs/${task.runId}/artifacts/${selectedFrame.id}`} title={selectedFrame.label} /> : <BrowserSurface key={browserSrc} src={browserSrc} active={task.status === "running" || task.status === "needs_approval"} title={`Cloud browser for ${task.title}`} />}
        {browserZoom > 1.01 && <button className="browser-zoom-reset" type="button" onClick={resetBrowserZoom}>Reset zoom</button>}
      </div>
    </aside>
    </>
  );
}
