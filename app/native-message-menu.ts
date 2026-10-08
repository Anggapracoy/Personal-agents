"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { isReactionEmoji } from "../lib/harness/reactions";
import { postNativeMessage, type NativeWindow } from "./native-bridge";

type Actions = { text: string; selected?: string; onReply?: () => void; onReact?: (emoji: string | null) => Promise<void> };
type Entry = { element: HTMLElement; actions: Actions };
const entries = new Map<string, Entry>();
let nextID = 0;
let schedule = () => {};
let stop: (() => void) | undefined;

function available(entry: Entry) {
  return entry.element.isConnected && !entry.element.closest('[inert],[aria-hidden="true"]');
}

function descriptor(key: string, entry: Entry) {
  const { element, actions } = entry;
  if (!available(entry)) return null;
  const rect = element.getBoundingClientRect();
  const chat = element.closest('.wd-task');
  const bounds = chat?.getBoundingClientRect();
  const headerBottom = chat?.querySelector('.wd-taskbar')?.getBoundingClientRect().bottom ?? 0;
  const top = Math.max(0, rect.top, bounds?.top ?? 0, headerBottom);
  const bottom = Math.min(window.innerHeight, rect.bottom, bounds?.bottom ?? window.innerHeight);
  const left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
  if (bottom <= top || right <= left) return null;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  if (!hit || !element.contains(hit)) return null;
  // Keep system link/image/media holds and ordinary interactive content independent.
  const excluded = [...element.querySelectorAll('a,button,img,video,audio,input,textarea')].map(node => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  // Badges sit outside the message box. Preview them without expanding its hold target.
  const previewRects = [rect, ...[...element.querySelectorAll('.wd-tapback')].map(node => node.getBoundingClientRect())]
    .map(r => {
      const x = Math.max(0, r.left), y = Math.max(0, bounds?.top ?? 0, headerBottom, r.top);
      return { x, y, width: Math.max(0, Math.min(window.innerWidth, r.right) - x),
        height: Math.max(0, Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight, r.bottom) - y) };
    }).filter(r => r.width > 0 && r.height > 0);
  return { key, text: actions.text, selected: actions.selected, previewRects,
    canReply: Boolean(actions.onReply), canReact: Boolean(actions.onReact),
    x: left, y: top, width: right - left, height: bottom - top, excluded };
}

function publish() {
  const items = [...entries].flatMap(([key, entry]) => { const item = descriptor(key, entry); return item ? [item] : []; });
  const keys = [...entries].filter(([, entry]) => available(entry)).map(([key]) => key);
  const payload = { items, keys, viewportWidth: window.innerWidth };
  return payload;
}

function start() {
  let frame = 0, previous = '';
  const flush = () => {
    frame = 0;
    const payload = publish(), serialized = JSON.stringify(payload);
    if (serialized !== previous) { previous = serialized; postNativeMessage({ version: 1, action: 'messageMenuItems', payload }); }
  };
  schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'inert', 'aria-hidden'] });
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  (window as NativeWindow).__decisionFeedMessageAction = async (key, action, emoji) => {
    const entry = entries.get(key);
    if (!entry || !available(entry)) throw new Error('This message is no longer available.');
    if (action === 'reply' && entry.actions.onReply) { entry.actions.onReply(); return; }
    if (action === 'react' && entry.actions.onReact && (emoji === null || isReactionEmoji(emoji))) {
      await entry.actions.onReact(emoji);
      return;
    }
    throw new Error('This message action is no longer available.');
  };
  stop = () => {
    cancelAnimationFrame(frame); observer.disconnect();
    document.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    delete (window as NativeWindow).__decisionFeedMessageAction;
    postNativeMessage({ version: 1, action: 'messageMenuItems', payload: { items: [], keys: [], viewportWidth: window.innerWidth } });
    schedule = () => {}; stop = undefined;
  };
  schedule();
}

export function useNativeMessageMenu(anchor: RefObject<HTMLDivElement>, actions: Actions) {
  const [key] = useState(() => `message-${++nextID}`);
  const latest = useRef(actions); latest.current = actions;
  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const entry: Entry = { element, actions: latest.current };
    entries.set(key, entry);
    if (!stop) start();
    const resize = new ResizeObserver(() => schedule()); resize.observe(element);
    schedule();
    return () => { resize.disconnect(); entries.delete(key); if (!entries.size) stop?.(); else schedule(); };
  }, [anchor, key]);
  useEffect(() => { const entry = entries.get(key); if (entry) entry.actions = actions; schedule(); });
  return {
    refresh: () => schedule(),
    open: () => {
      // Refresh synchronously before explicit keyboard/tap opening so its anchor is current.
      postNativeMessage({ version: 1, action: 'messageMenuItems', payload: publish() });
      postNativeMessage({ version: 1, action: 'showMessageMenu', payload: { key } });
    },
  };
}
