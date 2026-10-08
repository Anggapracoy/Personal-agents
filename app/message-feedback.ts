"use client";
import type { ThreadItem } from "../lib/harness/thread";
import { isNativeShell, postNativeMessage, type NativeWindow } from "./native-bridge";

let audio: AudioContext | undefined;
let lastReceive = -Infinity;
const heard = new Set<string>();

export function receiveMessageFeedback(items: ThreadItem[], openedAt: number, quiet = false) {
  let fresh = false;
  for (const item of items) {
    if (item.kind !== "agent" || heard.has(item.id)) continue;
    heard.add(item.id);
    if (item.createdAt && Date.parse(item.createdAt) >= openedAt && (item.text.trim() || item.photos?.length)) fresh = true;
  }
  if (heard.size > 2000) { const keep = [...heard].slice(-1000); heard.clear(); keep.forEach(id => heard.add(id)); }
  if (fresh && !quiet) playMessageFeedback("receive");
}

export function playMessageFeedback(kind: "send" | "receive") {
  if (typeof window === "undefined" || document.visibilityState !== "visible") return;
  if (kind === "receive") {
    if (performance.now() - lastReceive < 2000) return;
    lastReceive = performance.now();
  }
  if ((window as NativeWindow).__decisionFeedNativeMessageFeedback) {
    postNativeMessage({ version: 1, action: "messageFeedback", payload: { kind } });
    return;
  }
  // Older iPhone shells retain their supported haptic bridge until updated.
  if (isNativeShell()) {
    postNativeMessage({ version: 1, action: "hapticSelection" });
    return;
  }
  try {
    navigator.vibrate?.(kind === "send" ? 8 : 12);
    audio ??= new AudioContext();
    if (audio.state === "suspended") {
      if (kind !== "send") return;
      void audio.resume().then(() => tone(kind)).catch(() => undefined);
    } else tone(kind);
  } catch { /* Unsupported or blocked feedback never prevents sending. */ }
}

function tone(kind: "send" | "receive") {
  if (!audio || audio.state !== "running") return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  oscillator.frequency.setValueAtTime(kind === "send" ? 520 : 880, now);
  oscillator.frequency.linearRampToValueAtTime(kind === "send" ? 820 : 660, now + 0.14);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.065, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.start(now); oscillator.stop(now + 0.15);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
