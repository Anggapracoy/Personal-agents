"use client";
import { useEffect } from "react";
import { easterEggEventSchema } from "../lib/harness/easteregg-event";

const consumed = new Set<string>();
let stopActiveBurst: (() => void) | undefined;
export async function playConfetti() {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  if (document.hidden || reducedMotion.matches) return false;
  stopActiveBurst?.();
  // Individual DOM layers avoid WebKit's transparent animated-canvas corruption.
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.dashConfetti = "true";
  Object.assign(layer.style, { position: "fixed", inset: "0", overflow: "hidden", pointerEvents: "none", zIndex: "2147483647", contain: "layout style", isolation: "isolate" });
  document.body.appendChild(layer);
  const width = layer.clientWidth;
  const height = layer.clientHeight;
  const colors = ["#ff577f", "#ffd166", "#06d6a0", "#44aaff", "#b185ff"];
  const animations: Animation[] = [];
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; animations.forEach(animation => animation.cancel()); layer.remove(); };
  stopActiveBurst = stop;
  const motionChanged = () => { if (reducedMotion.matches) stop(); };
  const visibilityChanged = () => { if (document.hidden) stop(); };
  reducedMotion.addEventListener("change", motionChanged);
  document.addEventListener("visibilitychange", visibilityChanged);
  try {
    for (let index = 0; index < 220; index++) {
      const particle = document.createElement("span");
      const emoji = index >= 200;
      particle.textContent = emoji ? (index % 2 ? "🎉" : "✨") : "";
      Object.assign(particle.style, { position: "absolute", top: "0", left: "0", width: emoji ? "24px" : "8px", height: emoji ? "24px" : "12px", fontSize: "22px", lineHeight: "24px", borderRadius: emoji ? "0" : index % 3 ? "1px" : "50%", background: emoji ? "transparent" : colors[index % colors.length], willChange: "transform, opacity" });
      layer.appendChild(particle);
      const right = index % 2 === 0;
      const x = right ? width : 0;
      const launchDrop = 0.18;
      const y = height * (0.58 + launchDrop + Math.random() * 0.1);
      const vx = (right ? -1 : 1) * width * (0.12 + Math.random() * 1.3);
      // Compensate for the lower launch so the peak remains just as high.
      const lift = 1.7 + Math.random() * 1.3;
      const vy = -height * Math.sqrt(lift * lift + 4 * 3.3 * launchDrop);
      const spin = (Math.random() - 0.5) * 1080;
      const frames: Keyframe[] = Array.from({ length: 31 }, (_, frame) => {
        const t = frame / 30;
        return { offset: t, transform: `translate(${x + vx * (1 - Math.exp(-5 * t))}px, ${y + vy * t + height * 3.3 * t * t}px) rotate(${spin * t}deg) scaleX(${emoji ? 1 : Math.cos(t * 16 + index) * 0.8 + 0.2})`, opacity: t < 0.7 ? 1 : (1 - t) / 0.3 };
      });
      animations.push(particle.animate(frames, { duration: 2600 + Math.random() * 700, easing: "linear", fill: "forwards" }));
    }
    await Promise.allSettled(animations.map(animation => animation.finished));
  } finally {
    stop();
    reducedMotion.removeEventListener("change", motionChanged);
    document.removeEventListener("visibilitychange", visibilityChanged);
    if (stopActiveBurst === stop) stopActiveBurst = undefined;
  }
  return true;
}
export async function playEasterEgg(effect: "confetti" | "disco" | "snow" | "flip" | "67") {
  if (effect === "confetti") return playConfetti();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  if (document.hidden || reducedMotion.matches) return false;
  const avatar = effect === "flip" ? document.querySelector<HTMLElement>(".wd-taskbar-title > .wd-icon") : null;
  if (effect === "flip" && !avatar) return false;
  stopActiveBurst?.();
  const layer = document.createElement("div");
  layer.dataset.dashEasteregg = effect;
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", overflow: "hidden", zIndex: "2147483647", isolation: "isolate" });
  document.body.appendChild(layer);
  const width = layer.clientWidth, height = layer.clientHeight;
  const animations: Animation[] = [];
  const priorVisibility = avatar?.style.visibility ?? "";
  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    animations.forEach(animation => animation.cancel()); layer.remove();
    if (avatar) avatar.style.visibility = priorVisibility;
  };
  stopActiveBurst = stop;
  const motionChanged = () => { if (reducedMotion.matches) stop(); };
  const visibilityChanged = () => { if (document.hidden) stop(); };
  reducedMotion.addEventListener("change", motionChanged);
  document.addEventListener("visibilitychange", visibilityChanged);
  try {
    if (effect === "67") {
      const chat = document.querySelector<HTMLElement>(".wd-front-layer");
      if (!chat) return false;
      animations.push(chat.animate([
        { transform: "skewY(0deg)", offset: 0 },
        { transform: "skewY(14deg)", offset: .1 },
        { transform: "skewY(-14deg)", offset: .3 },
        { transform: "skewY(14deg)", offset: .5 },
        { transform: "skewY(-14deg)", offset: .7 },
        { transform: "skewY(14deg)", offset: .86, easing: "ease-out" },
        { transform: "skewY(0deg)", offset: 1 },
      ], { duration: 2300, easing: "linear" }));
      const mascot = document.querySelector<HTMLElement>(".wd-taskbar-title > .wd-icon");
      if (mascot) {
        const base = getComputedStyle(mascot).transform;
        const transform = base === "none" ? "" : base;
        animations.push(mascot.animate([
          { transform: `${transform} translateX(0px) rotate(0deg)`, offset: 0 },
          { transform: `${transform} translateX(12px) rotate(18deg)`, offset: .1 },
          { transform: `${transform} translateX(-12px) rotate(-18deg)`, offset: .3 },
          { transform: `${transform} translateX(12px) rotate(18deg)`, offset: .5 },
          { transform: `${transform} translateX(-12px) rotate(-18deg)`, offset: .7 },
          { transform: `${transform} translateX(12px) rotate(18deg)`, offset: .86, easing: "ease-out" },
          { transform: `${transform} translateX(0px) rotate(0deg)`, offset: 1 },
        ], { duration: 2300, easing: "linear" }));
      }
    } else if (effect === "flip" && avatar) {
      const rect = avatar.getBoundingClientRect();
      const clone = avatar.cloneNode(true) as HTMLElement;
      Object.assign(clone.style, { position: "absolute", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", visibility: "visible", transformOrigin: "center", willChange: "transform" });
      layer.appendChild(clone); avatar.style.visibility = "hidden";
      animations.push(clone.animate([
        { transform: "translateY(0) rotate(0deg) scale(1)", offset: 0 },
        { transform: "translateY(4px) rotate(-12deg) scale(1.05, .9)", offset: .16 },
        { transform: "translateY(24px) rotate(120deg) scale(1)", offset: .42 },
        { transform: "translateY(18px) rotate(260deg) scale(1)", offset: .7 },
        { transform: "translateY(0) rotate(360deg) scale(1)", offset: 1 },
      ], { duration: 1100, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }));
    } else if (effect === "snow") {
      for (let index = 0; index < 125; index++) {
        const flake = document.createElement("span");
        flake.textContent = index % 4 === 0 ? "❄" : "•";
        const size = 7 + Math.random() * 13;
        Object.assign(flake.style, { position: "absolute", left: `${Math.random() * width}px`, top: "0", fontSize: `${size}px`, color: "#ffffff", textShadow: "0 0 2px #8cb9d5, 0 1px 3px #8cb9d5", willChange: "transform, opacity" });
        layer.appendChild(flake);
        const start = -20 - Math.random() * height * .6;
        const drift = (Math.random() - .5) * 80;
        const frames = Array.from({ length: 21 }, (_, frame) => { const t = frame / 20; const fall = .7 * t + .3 * t * t; return { offset: t, transform: `translate(${drift * t + Math.sin(t * 8 + index) * 12}px, ${start + (height - start + 30) * fall}px) rotate(${t * 160}deg)`, opacity: t < .8 ? .8 : (1 - t) * 4 }; });
        animations.push(flake.animate(frames, { duration: 3900 + Math.random() * 1400, easing: "linear", fill: "both" }));
      }
    } else if (effect === "disco") {
      const veil = document.createElement("div");
      Object.assign(veil.style, { position: "absolute", inset: "0", background: "radial-gradient(ellipse at 50% 18%, #44337622, #11152d88)" });
      layer.appendChild(veil);
      animations.push(veil.animate([{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: 5500, fill: "both" }));
      const ball = document.createElement("div");
      Object.assign(ball.style, { position: "absolute", left: "calc(50% - 34px)", top: `${Math.max(100, height * .15)}px`, width: "68px", height: "68px", borderRadius: "50%", overflow: "hidden", background: "#c9d3e5", boxShadow: "0 0 22px #ffffffbb, 0 0 60px #b1a2ff88, 4px 8px 20px #080d2855" });
      const tiles = document.createElement("div");
      Object.assign(tiles.style, { position: "absolute", inset: "-20%", background: "repeating-conic-gradient(#f7faff 0% 25%, #8993ad 0% 50%) 0 0 / 12px 12px", transform: "rotate(15deg)" });
      const shine = document.createElement("div");
      Object.assign(shine.style, { position: "absolute", inset: "0", borderRadius: "50%", background: "radial-gradient(circle at 28% 25%, #ffffff 0%, #ffffff88 9%, transparent 30%, #07152e44 60%, #040a1bcc 100%)" });
      ball.append(tiles, shine); layer.appendChild(ball);
      animations.push(tiles.animate([{ backgroundPosition: "0px 0px" }, { backgroundPosition: "72px 12px" }], { duration: 5500, easing: "linear", fill: "both" }));
      animations.push(ball.animate([{ transform: "translateY(-40px) scale(.65)", opacity: 0 }, { transform: "translateY(0) scale(1)", opacity: 1, offset: .12 }, { transform: "translateY(3px) scale(1)", opacity: 1, offset: .85 }, { transform: "translateY(-25px) scale(.8)", opacity: 0 }], { duration: 5500, easing: "ease-in-out", fill: "both" }));
      const colors = ["255,50,165", "110,75,255", "30,175,255", "30,230,175", "255,180,60", "235,90,250"];
      colors.forEach((color, index) => {
        const beam = document.createElement("div");
        Object.assign(beam.style, { position: "absolute", left: "-25%", top: "0", width: "150%", height: "140%", background: `conic-gradient(from 150deg at 50% 0%, transparent 0deg, rgba(${color},.38) 10deg, rgba(${color},.16) 19deg, transparent 28deg)`, transformOrigin: "50% 0%", willChange: "transform, opacity" });
        layer.insertBefore(beam, ball);
        animations.push(beam.animate([{ transform: `rotate(${-45 + index * 27}deg)`, opacity: 0 }, { transform: `rotate(${-25 + index * 20}deg)`, opacity: 1, offset: .2 }, { transform: `rotate(${30 - index * 20}deg)`, opacity: 1, offset: .8 }, { transform: `rotate(${45 - index * 27}deg)`, opacity: 0 }], { duration: 5500, easing: "ease-in-out", fill: "both" }));
      });
      for (let index = 0; index < 38; index++) {
        const glint = document.createElement("span"); glint.textContent = "✦";
        Object.assign(glint.style, { position: "absolute", left: `${Math.random() * width}px`, top: `${height * (.2 + Math.random() * .65)}px`, color: ["#c982f5", "#ee83b9", "#7aaeee"][index % 3], fontSize: `${8 + Math.random() * 12}px` });
        layer.appendChild(glint);
        animations.push(glint.animate([{ opacity: 0, transform: "translateX(-20px) scale(.7)" }, { opacity: .7, transform: "translateX(15px) scale(1.2)", offset: .3 }, { opacity: .5, transform: "translateX(-10px) scale(.8)", offset: .7 }, { opacity: 0, transform: "translateX(-20px) scale(.7)" }], { duration: 5500, easing: "ease-in-out", fill: "both" }));
      }
    }
    await Promise.allSettled(animations.map(animation => animation.finished));
  } finally {
    stop(); reducedMotion.removeEventListener("change", motionChanged); document.removeEventListener("visibilitychange", visibilityChanged);
    if (stopActiveBurst === stop) stopActiveBurst = undefined;
  }
  return true;
}
export function useEasterEggEvent(value: unknown) {
  useEffect(() => {
    const parsed = easterEggEventSchema.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    const key = `dash:easteregg:${event.id}`;
    if (consumed.has(event.id)) return;
    try { if (sessionStorage.getItem(key) || sessionStorage.getItem(`dash:confetti:${event.id}`)) return; } catch { /* memory deduplication remains */ }
    consumed.add(event.id);
    try { sessionStorage.setItem(key, "1"); } catch { /* restricted storage */ }
    const age = Date.now() - Date.parse(event.createdAt);
    if (age < -5000 || age > 30000 || document.hidden) return;
    void playEasterEgg(event.effect).catch(() => { /* cosmetic effect must never break chat */ });
  }, [value]);
}
