import { fitMessageText } from './message-text-layout';

/** Match Messages' shared top-to-bottom blue field without fixed backgrounds,
 * which are unreliable inside the iPhone's scrolling WebView. */
export function paintMessageGradient(page: HTMLElement) {
  fitMessageText(page);
  const colorAt = (position: number) => {
    // Bring the lighter blue farther down the viewport while keeping both endpoints.
    const progress = Math.pow(Math.max(0, Math.min(1, position)), 1.3);
    return `rgb(${Math.round(86 - 66 * progress)}, ${Math.round(179 - 40 * progress)}, ${Math.round(250 + 5 * progress)})`;
  };

  const bounds = page.getBoundingClientRect();
  const height = Math.max(1, bounds.height);
  const bubbles = Array.from(page.querySelectorAll<HTMLElement>('.wd-bubble.is-me'));
  const positions = bubbles.map(bubble => bubble.getBoundingClientRect());
  bubbles.forEach((bubble, index) => {
    const rect = positions[index];
    bubble.style.setProperty('--message-body-height', `${rect.height}px`);
    bubble.style.setProperty('--message-blue-top', colorAt((rect.top - bounds.top) / height));
    bubble.style.setProperty('--message-blue-bottom', colorAt((rect.bottom - bounds.top) / height));
  });
}

export function attachMessageGradient(page: HTMLElement) {
  let frame = 0;
  const paint = () => { frame = 0; paintMessageGradient(page); };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
  const resize = new ResizeObserver(schedule);
  resize.observe(page);
  const thread = page.querySelector('.wd-thread');
  if (thread) resize.observe(thread);
  const changes = new MutationObserver(schedule);
  changes.observe(page, { childList: true, subtree: true, characterData: true });
  page.addEventListener('scroll', schedule, { passive: true });
  paint();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    changes.disconnect();
    page.removeEventListener('scroll', schedule);
  };
}
