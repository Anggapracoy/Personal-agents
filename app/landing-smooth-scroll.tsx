"use client";

import { useEffect } from "react";
import Lenis from "lenis";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => value * value * (3 - 2 * value);
const measureTop = (element: HTMLElement) => {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
  return top;
};

/** Scroll is the animation clock; no timers, autoplay, or React renders per frame. */
export default function LandingSmoothScroll() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>("[data-dash-landing]");
    if (!page) return;
    const hero = page.querySelector<HTMLElement>("[data-hero]")!;
    const heroStage = page.querySelector<HTMLElement>("[data-hero-stage]")!;
    const heroCopy = page.querySelector<HTMLElement>("[data-hero-copy]")!;
    const characters = [...page.querySelectorAll<HTMLElement>("[data-orbit-character]")];
    const words = [...page.querySelectorAll<HTMLElement>("[data-intro-word]")];
    const story = page.querySelector<HTMLElement>("[data-story]")!;
    const getScenes = () => [...page.querySelectorAll<HTMLElement>("[data-scene]")];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileViewport = window.matchMedia("(max-width: 760px)");
    const wideViewport = window.matchMedia("(min-width: 761px) and (min-height: 650px)");
    let lenis: Lenis | undefined;
    let frame = 0;
    let enabled = false;
    let viewportHeight = window.innerHeight;
    let viewportWidth = window.innerWidth;
    const positions = new Map<HTMLElement, number>();
    let heroHeight = 1;
    let storyHeight = 1;
    let documentHeight = 1;
    const layoutTop = (element: HTMLElement) => positions.get(element) ?? 0;
    const measure = () => {
      positions.clear();
      const elements = [hero, story, ...page.querySelectorAll<HTMLElement>(
        "[data-reveal], [data-scene-copy], [data-phone-stage], [data-message-step]"
      )];
      for (const element of elements) positions.set(element, measureTop(element));
      documentHeight = document.documentElement.scrollHeight;
      if (mobileViewport.matches && !reducedMotion.matches) viewportHeight = heroStage.clientHeight;
      heroHeight = hero.offsetHeight;
      storyHeight = story.offsetHeight;
    };

    const update = () => {
      frame = 0;
      if (!reducedMotion.matches) {
        const scrollTop = window.scrollY;
        const maxScroll = Math.max(0, documentHeight - viewportHeight);
        // Offset coordinates ignore the reveal translation and character rotation.
        // Use each item's actual position, not its section's empty leading padding.
        const reveals = [...page.querySelectorAll<HTMLElement>("[data-reveal]")].map(element => {
          const top = layoutTop(element);
          const delay = Number(element.dataset.reveal || 0) * viewportHeight * .12;
          const start = Math.min(top - viewportHeight * (mobileViewport.matches ? .76 : .94) + delay, maxScroll - 1);
          const end = Math.min(start + viewportHeight * .4, maxScroll);
          const reveal = ease(clamp((scrollTop - start) / Math.max(1, end - start)));
          return { element, reveal };
        });
        reveals.forEach(({ element, reveal }) => {
          element.style.setProperty("--reveal-opacity", String(clamp(reveal * 3)));
          element.style.setProperty("--reveal-rest", String(1 - reveal));
        });

      }
      if (!reducedMotion.matches && mobileViewport.matches) {
        const scrollTop = window.scrollY;
        const heroRect = { top: layoutTop(hero) - window.scrollY, height: heroHeight };
        const progress = clamp(-heroRect.top / Math.max(1, heroRect.height - viewportHeight));
        const heroProgress = ease(progress);
        const fade = 1 - ease(clamp((progress - .12) / .3));
        page.style.setProperty("--mobile-hero-progress", String(heroProgress));
        page.style.setProperty("--hero-opacity", String(fade));
        page.style.setProperty("--hero-y", `${-viewportHeight * .3 * ease(clamp(progress / .42))}px`);
        const entrance = ease(clamp((progress - .36) / .22));
        page.style.setProperty("--intro-opacity", String(entrance));
        page.style.setProperty("--mobile-intro-y", `${(1 - entrance) * 48}px`);
        heroCopy.inert = fade < .05;
        characters.forEach(character => { character.style.opacity = String(1 - ease(clamp((progress - .15) / .3))); });
        const reading = clamp((progress - .48) / .47) * (words.length + 2);
        words.forEach((word, index) => { word.style.opacity = String(.22 + ease(clamp(reading - index)) * .78); });
        getScenes().forEach((scene, index) => {
          const copy = scene.querySelector<HTMLElement>("[data-scene-copy]")!;
          const copyProgress = ease(clamp((viewportHeight * .76 - (layoutTop(copy) - scrollTop)) / (viewportHeight * .42)));
          scene.style.setProperty("--mobile-copy-rest", String(1 - copyProgress));
          const phone = scene.querySelector<HTMLElement>("[data-phone-stage]")!;
          const phoneProgress = ease(clamp((viewportHeight * .8 - (layoutTop(phone) - scrollTop)) / (viewportHeight * .45)));
          phone.style.setProperty("--mobile-phone-rest", String(1 - phoneProgress));
          phone.style.setProperty("--mobile-phone-tilt", `${index % 2 ? 3 : -3}deg`);
          scene.querySelectorAll<HTMLElement>("[data-message-step]").forEach(message => {
            const visible = ease(clamp((viewportHeight * .8 - (layoutTop(message) - scrollTop)) / (viewportHeight * .34)));
            message.style.opacity = String(visible);
            message.style.transform = `translateY(${(1 - visible) * 18}px) scale(${.94 + visible * .06})`;
          });
        });
      }
      if (!enabled) return;
      const heroRect = { top: layoutTop(hero) - window.scrollY, height: heroHeight };
      const storyRect = { top: layoutTop(story) - window.scrollY, height: storyHeight };
      const progress = clamp(-heroRect.top / Math.max(1, heroRect.height - viewportHeight));
      const fade = 1 - ease(clamp((progress - .12) / .3));
      page.style.setProperty("--hero-opacity", String(fade));
      page.style.setProperty("--hero-y", `${-viewportHeight * .24 * ease(clamp(progress / .42))}px`);
      page.style.setProperty("--intro-opacity", String(ease(clamp((progress - .36) / .22))));
      heroCopy.inert = fade < .05;
      const spread = ease(clamp((progress - .02) / .7));
      characters.forEach((character, index) => {
        // A gentle turn opens the ring as the hero gives way to the introduction.
        const angle = ([-45, 0, 45, 135, 180, 225][index] + spread * 14) * Math.PI / 180;
        const radius = 1 + spread * .55;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const tilt = (index % 3 - 1) * 8 + spread * 18;
        character.style.transform = `translate(calc(-50% + ${x.toFixed(4)} * var(--orbit-radius-x)), calc(-50% + ${y.toFixed(4)} * var(--orbit-radius-y))) rotate(${tilt}deg) scale(${1 - spread * .08})`;
        character.style.opacity = String(1 - ease(clamp((progress - .42) / .48)));
      });
      const readingProgress = clamp((progress - .48) / .47) * (words.length + 2);
      words.forEach((word, index) => { word.style.opacity = String(.22 + ease(clamp(readingProgress - index)) * .78); });

      // Read the current nodes so live preview edits cannot leave detached message references.
      const scenes = getScenes();
      const storyProgress = clamp(-storyRect.top / Math.max(1, storyRect.height - viewportHeight)) * scenes.length;
      scenes.forEach((scene, index) => {
        const entrance = index === 0 ? 1 : ease(clamp((storyProgress - index + .08) / .16));
        const exit = index === scenes.length - 1 ? 1 : 1 - ease(clamp((storyProgress - index - 1 + .08) / .16));
        const opacity = Math.min(entrance, exit);
        scene.style.opacity = String(opacity);
        scene.style.transform = `translateY(${(1 - entrance) * 24 - (1 - exit) * 24}px)`;
        const localProgress = storyProgress - index;
        scene.querySelectorAll<HTMLElement>("[data-message-step]").forEach(message => {
          const step = Number(message.dataset.messageStep);
          const visible = step === 0 ? 1 : ease(clamp((localProgress - step * .22 + .04) / .12));
          message.style.opacity = String(visible);
          message.style.transform = `translateY(${(1 - visible) * 9}px)`;
        });
      });

    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const configure = () => {
      enabled = !reducedMotion.matches && wideViewport.matches;
      viewportWidth = window.innerWidth;
      // Match the CSS 100svh stage, not the browser toolbar's changing viewport.
      viewportHeight = mobileViewport.matches && !reducedMotion.matches
        ? heroStage.clientHeight
        : window.innerHeight;
      if (reducedMotion.matches) {
        page.querySelectorAll<HTMLElement>("[data-reveal]").forEach(element => {
          element.style.removeProperty("--reveal-opacity");
          element.style.removeProperty("--reveal-rest");
        });
      }
      if (!enabled) {
        heroCopy.inert = false;
        for (const element of [...characters, ...words, ...getScenes(), ...page.querySelectorAll<HTMLElement>("[data-message-step]")]) {
          element.style.removeProperty("opacity");
          element.style.removeProperty("transform");
        }
      }
      if (reducedMotion.matches || mobileViewport.matches) { lenis?.destroy(); lenis = undefined; }
      else if (!lenis) {
        lenis = new Lenis({ anchors: true, autoRaf: true, lerp: .12, overscroll: false, respectReducedMotion: true, smoothWheel: true, stopInertiaOnNavigate: true, syncTouch: false, wheelMultiplier: .9 });
        lenis.on("scroll", schedule);
      }
      measure();
      lenis?.resize();
      if (frame) cancelAnimationFrame(frame);
      update();
    };
    const onResize = () => {
      // Toolbar expansion/collapse must not reset styles midway through a swipe.
      if (mobileViewport.matches && window.innerWidth === viewportWidth) {
        schedule();
        return;
      }
      configure();
    };
    configure();
    // Images, fonts, and responsive content can resize without a window resize.
    // Transforms and opacity do not change these observed layout dimensions.
    const layoutObserver = new ResizeObserver(() => {
      measure();
      schedule();
    });
    layoutObserver.observe(page);
    layoutObserver.observe(heroStage);
    window.addEventListener("pageshow", configure);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    reducedMotion.addEventListener("change", configure);
    wideViewport.addEventListener("change", configure);
    mobileViewport.addEventListener("change", configure);
    return () => {
      cancelAnimationFrame(frame);
      layoutObserver.disconnect();
      lenis?.destroy();
      window.removeEventListener("pageshow", configure);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      reducedMotion.removeEventListener("change", configure);
      wideViewport.removeEventListener("change", configure);
      mobileViewport.removeEventListener("change", configure);
    };
  }, []);
  return null;
}
