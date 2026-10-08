"use client";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNativeMessageMenu } from "./native-message-menu";
import { postNativeMessage, type NativeWindow } from "./native-bridge";
import { isReactionEmoji, type MessageReaction } from "../lib/harness/reactions";

const quick = [{ emoji: "❤️", name: "Heart" }, { emoji: "👍", name: "Thumbs up" }, { emoji: "👎", name: "Thumbs down" }, { emoji: "😂", name: "Laugh" }, { emoji: "‼️", name: "Emphasis" }, { emoji: "❓", name: "Question" }];
const more = ["😊", "🙏", "🎉", "🔥", "👀", "✅", "🤔", "😮", "😢", "🙌", "💯", "🤝", "🥰", "😅", "🫡", "👌", "💙", "🤣", "🤞", "💪", "✨", "👋", "😎", "🥳"];

type MessageReactionProps = {
  className?: string; messageId?: string; text?: string; onReply?: () => void; mine?: boolean; reactions?: MessageReaction[]; onReact?: (emoji: string | null) => Promise<void>; children: ReactNode;
};

const subscribeToNativeMenus = () => () => {};
const nativeMenusSnapshot = () => Boolean((window as NativeWindow).__decisionFeedNativeMessageMenus);

export function MessageReaction(props: MessageReactionProps) {
  const native = useSyncExternalStore(subscribeToNativeMenus, nativeMenusSnapshot, () => false);
  const [pendingReaction, setPendingReaction] = useState<{ id: number; emoji: string | null } | null>(null);
  const reactionSequence = useRef(0);
  const reactionQueue = useRef<Promise<void>>(Promise.resolve());
  const react = props.onReact;
  const onReact = react ? (emoji: string | null) => {
    const id = ++reactionSequence.current;
    setPendingReaction({ id, emoji });
    // Preserve tap order even if the user changes their reaction while a save is pending.
    const request = reactionQueue.current.catch(() => {}).then(() => react(emoji));
    reactionQueue.current = request;
    return request.finally(() => {
      setPendingReaction(current => current?.id === id ? null : current);
    });
  } : undefined;
  const reactions = pendingReaction
    ? [...(props.reactions ?? []).filter(reaction => reaction.actor !== "user"),
      ...(pendingReaction.emoji ? [{ actor: "user" as const, emoji: pendingReaction.emoji, createdAt: "" }] : [])]
    : props.reactions;
  const displayProps = { ...props, reactions, onReact };
  return native ? <NativeMessageReaction {...displayProps} /> : <WebMessageReaction {...displayProps} />;
}

function NativeMessageReaction({ mine = false, messageId, reactions = [], onReact, onReply, text = "", className = "", children }: MessageReactionProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useNativeMessageMenu(anchor, { text, onReact, onReply, selected: reactions.find(reaction => reaction.actor === "user")?.emoji });
  return <div ref={anchor} data-native-message-menu data-message-id={messageId} className={`wd-reactable ${className}${mine ? " is-me" : ""}${reactions.length ? " has-reaction" : ""}`}
    onPointerDown={menu.refresh}
    onDoubleClick={event => { if (!(event.target as HTMLElement).closest("button,a,img,video,audio")) menu.open(); }}
    onContextMenu={event => { if (!(event.target as HTMLElement).closest("a,img,video,audio,.wd-photo-thumb,.wd-photo-full")) event.preventDefault(); }}>
    {children}
    {(onReact || onReply) && <button type="button" className="wd-react-trigger" aria-label="Message actions" aria-haspopup="menu" onClick={menu.open}>⋯</button>}
    <MessageTapbacks reactions={reactions} canReact={Boolean(onReact)} onOpen={menu.open} />
  </div>;
}

function WebMessageReaction({ mine = false, messageId, reactions = [], onReact, onReply, text = "", className = "", children }: MessageReactionProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyPending = useRef(false);
  const session = useRef(0);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const motion = useRef({ value: 0, velocity: 0 });
  const picker = useRef<HTMLDivElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState<{ top: number; left: number; width: number; controlsLeft: number; quickTop: number; menuTop: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = reactions.find(reaction => reaction.actor === "user")?.emoji;
  const clearHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const close = (restoreFocus = false) => { clearHold(); opened.current = false; session.current++; if (copyTimer.current) clearTimeout(copyTimer.current); setVisible(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); };
  const open = () => {
    clearHold();
    if ((!onReact && !onReply) || busy || opened.current || !anchor.current) return;
    opened.current = true;
    session.current++;
    copyPending.current = false;
    setCopied(false);
    postNativeMessage({ version: 1, action: "hapticSelection" });
    const selection = window.getSelection();
    if (selection && (anchor.current.contains(selection.anchorNode) || anchor.current.contains(selection.focusNode))) selection.removeAllRanges();
    const rect = anchor.current.getBoundingClientRect();
    const width = Math.min(328, window.innerWidth - 24);
    const controlsLeft = Math.max(12, Math.min(mine ? rect.right - width : rect.left, window.innerWidth - width - 12));
    const topEdge = Math.max(12, (anchor.current.closest(".wd-task")?.querySelector(".wd-taskbar")?.getBoundingClientRect().bottom ?? 4) + 8);
    const quickTop = Math.max(topEdge, rect.top - 66);
    const menuHeight = onReply ? 92 : 46;
    const menuTop = rect.bottom + 12 + menuHeight <= window.innerHeight - 12
      ? rect.bottom + 12
      : Math.max(topEdge, rect.top - (onReact ? 76 : 12) - menuHeight);
    setPosition({ top: rect.top, left: rect.left, width: rect.width, controlsLeft, quickTop, menuTop });
    setVisible(true);
    setExpanded(false);
    setError("");
  };
  useEffect(() => () => { clearHold(); session.current++; if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useLayoutEffect(() => {
    if (!position) return;
    let frame = 0, previous = 0;
    const reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)").matches;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = () => {
      const value = motion.current.value;
      const backdrop = overlay.current?.querySelector<HTMLElement>(".wd-reaction-dismiss");
      if (backdrop) {
        // Keep the backdrop outside an opacity group: WebKit otherwise resolves
        // its blur separately from the fading menu.
        backdrop.style.backgroundColor = `rgba(0, 0, 0, ${.11 * value})`;
        backdrop.style.backdropFilter = reducedTransparency ? "none" : `blur(${3 * value}px)`;
        backdrop.style.setProperty("-webkit-backdrop-filter", reducedTransparency ? "none" : `blur(${3 * value}px)`);
      }
      const preview = picker.current?.querySelector<HTMLElement>(".wd-reaction-selected");
      if (preview) preview.style.opacity = String(value);
      for (const control of picker.current?.querySelectorAll<HTMLElement>(".wd-reaction-controls") ?? []) control.style.opacity = String(value);
      for (const control of picker.current?.querySelectorAll<HTMLElement>(".wd-reaction-controls") ?? []) control.style.transform = reduced ? "none" : `translateY(${(1 - value) * 8}px) scale(${.94 + value * .06})`;
    };
    paint();
    const tick = (now: number) => {
      const dt = Math.min(previous ? (now - previous) / 1000 : 1 / 60, .032); previous = now;
      const state = motion.current, target = visible ? 1 : 0;
      if (reduced) { state.value = target; state.velocity = 0; }
      else for (let i = 0; i < 4; i++) { state.velocity += (640 * (target - state.value) - 50 * state.velocity) * dt / 4; state.value += state.velocity * dt / 4; }
      if (Math.abs(target - state.value) < .002 && Math.abs(state.velocity) < .02) {
        state.value = target; state.velocity = 0; paint();
        if (!visible) { setPosition(null); setExpanded(false); }
      } else { paint(); frame = requestAnimationFrame(tick); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, position]);
  useEffect(() => {
    if (!position) return;
    picker.current?.querySelector<HTMLButtonElement>(".wd-reaction-controls button")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
      if (event.key === "Tab") {
        const nodes = Array.from(picker.current?.querySelectorAll<HTMLElement>('.wd-reaction-controls button:not(:disabled),.wd-reaction-controls input') ?? []);
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus();
      }
    };
    const dismiss = () => close();
    const outside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".wd-reaction-controls")) { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", dismiss); };
  }, [position]);
  const copy = async () => {
    if (copyPending.current || copied) return;
    copyPending.current = true;
    setError("");
    const currentSession = session.current;
    try {
      await navigator.clipboard.writeText(text);
      if (session.current !== currentSession || !opened.current) return;
      setCopied(true);
      postNativeMessage({ version: 1, action: "hapticSuccess" });
      copyTimer.current = setTimeout(() => close(true), 650);
    } catch {
      if (session.current === currentSession) setError("Copy couldn’t complete. Try again.");
    } finally { if (session.current === currentSession) copyPending.current = false; }
  };
  const choose = async (emoji: string) => {
    if (!onReact || busy) return;
    setBusy(true); setError("");
    try { await onReact(selected === emoji ? null : emoji); close(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Reaction couldn’t send. Try again."); }
    finally { setBusy(false); }
  };
  return <div ref={anchor} data-message-id={messageId} className={`wd-reactable ${className}${mine ? " is-me" : ""}${reactions.length ? " has-reaction" : ""}`}
    onDoubleClick={event => { if ((event.target as HTMLElement).closest("button,a,video,audio")) return; open(); }}
    onContextMenu={event => { if ((event.target as HTMLElement).closest(".wd-photo-thumb,.wd-photo-full")) return; if (onReact || onReply) { event.preventDefault(); open(); } }}
    onPointerDown={event => { if (event.button !== 0 || !event.isPrimary || opened.current || (!onReact && !onReply) || (event.target as HTMLElement).closest("button,a,video,audio")) return; clearHold(); start.current = { x: event.clientX, y: event.clientY }; hold.current = setTimeout(open, 450); }}
    onPointerMove={event => { if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) clearHold(); }}
    onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold}>
    {children}
    {(onReact || onReply) && <button ref={trigger} type="button" className="wd-react-trigger" aria-label="Message actions" aria-expanded={visible} onClick={open}>⋯</button>}
    <MessageTapbacks reactions={reactions} canReact={Boolean(onReact)} onOpen={open} />
    {position && createPortal(<div ref={overlay} className="wd-reaction-overlay" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
      <button className="wd-reaction-dismiss" aria-label="Close reactions" tabIndex={-1} onClick={() => close()} />
      <div ref={picker} className="wd-reaction-picker" role="dialog" aria-modal="true" aria-label="Message actions">
        <div className="wd-reaction-selected wd-task" inert style={{ position: "absolute", top: position.top, left: position.left, width: position.width }}><div className={`wd-reactable${mine ? " is-me" : ""}`} style={{ maxWidth: "100%" }}>{children}</div></div>
        <div className="wd-reaction-controls" style={{ position: "absolute", top: position.quickTop, left: position.controlsLeft, width: Math.min(328, window.innerWidth - 24), ...(expanded ? { maxHeight: window.innerHeight - position.quickTop - 12, overflowY: "auto" as const } : {}) }}>
        {onReact && <div className="wd-reaction-quick">{quick.map(item => <button key={item.emoji} disabled={busy} aria-label={item.name} aria-pressed={selected === item.emoji} onClick={() => void choose(item.emoji)}>{item.emoji}</button>)}<button aria-label="More emoji" aria-expanded={expanded} disabled={busy} onClick={() => setExpanded(value => !value)}>＋</button></div>}
        {expanded && <div className="wd-reaction-more"><div>{more.map(emoji => <button key={emoji} disabled={busy} aria-label={`React ${emoji}`} aria-pressed={selected === emoji} onClick={() => void choose(emoji)}>{emoji}</button>)}</div><form onSubmit={event => { event.preventDefault(); if (isReactionEmoji(custom)) void choose(custom); }}><input aria-label="Any emoji" placeholder="Any emoji" value={custom} onChange={event => setCustom(event.target.value.trim())} maxLength={32} /><button disabled={busy || !isReactionEmoji(custom)} type="submit">Add</button></form></div>}
        </div>
        {!expanded && <div className="wd-reaction-controls" style={{ position: "absolute", top: position.menuTop, left: mine ? position.controlsLeft + Math.min(328, window.innerWidth - 24) - Math.min(240, window.innerWidth - 24) : position.controlsLeft }}>
          <div className="wd-message-menu" style={{ marginTop: 0 }}>
            {onReply && <button onClick={() => { close(); onReply(); }}><span>Reply</span><MenuIcon kind="reply" /></button>}
            <button onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy"} className={copied ? "is-copied" : ""}><span className="wd-copy-label"><span aria-hidden={copied}>Copy</span><span aria-hidden={!copied}>Copied</span></span><span className="wd-copy-icon"><MenuIcon kind="copy" /><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg></span></button>
          </div>
        </div>}
        {error && <p className="wd-reaction-controls" style={{ position: "absolute", top: position.menuTop + 100, left: position.controlsLeft }} role="alert">{error}</p>}
      </div>
    </div>, anchor.current?.closest(".wd") ?? document.body)}
  </div>;
}

function MessageTapbacks({ reactions, canReact, onOpen }: { reactions: MessageReaction[]; canReact: boolean; onOpen: () => void }) {
  if (!reactions.length) return null;
  return <div className="wd-tapbacks">{reactions.map(reaction => <button type="button" key={reaction.actor} className={`wd-tapback${reaction.actor === "user" ? " is-selected" : ""}`} aria-label={`${reaction.actor === "user" ? "You" : "Dash"} reacted ${reaction.emoji}${reaction.actor === "user" && canReact ? ", change reaction" : ""}`} onClick={reaction.actor === "user" ? onOpen : undefined}>{reaction.emoji}</button>)}</div>;
}

function MenuIcon({ kind }: { kind: "reply" | "copy" }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {kind === "reply" ? <><path d="m9 5-6 6 6 6v-4h5c3 0 5 2 7 5-1-7-4-9-9-9H9Z" /></> : <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>}

  </svg>;
}
