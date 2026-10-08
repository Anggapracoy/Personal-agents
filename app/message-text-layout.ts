/** Fit wrapped text to its longest rendered line, like a native text bubble. */
const measured = new WeakMap<HTMLElement, { text: string; available: number; font: string }>();

export function fitMessageText(page: HTMLElement) {
  const phone = matchMedia('(max-width: 760px)').matches;
  for (const bubble of page.querySelectorAll<HTMLElement>('.wd-reactable > .wd-agent, .wd-reactable > .wd-bubble.is-me')) {
    if (!phone || bubble.querySelector('img, video, pre, table, ul, ol, button, .wd-link-preview') || bubble.parentElement?.querySelector('.wd-quoted-reply')) {
      bubble.style.width = ''; measured.delete(bubble); continue;
    }
    const text = bubble.textContent ?? '';
    const available = page.clientWidth;
    const css = getComputedStyle(bubble);
    const font = `${css.font}|${css.letterSpacing}`;
    const prior = measured.get(bubble);
    if (prior?.text === text && prior.available === available && prior.font === font) continue;
    bubble.style.width = '';
    const bounds = bubble.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const naturalWidth = parseFloat(css.width);
    const scale = bounds.width / naturalWidth;
    const lines = new Map<number, { left: number; right: number }>();
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const y = Math.round(rect.top);
        const line = lines.get(y);
        lines.set(y, { left: Math.min(line?.left ?? Infinity, rect.left), right: Math.max(line?.right ?? -Infinity, rect.right) });
      }
    }
    if (lines.size > 1) {
      const padding = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight);
      const width = Math.ceil(Math.max(...Array.from(lines.values(), line => (line.right - line.left) / scale)) + padding);
      bubble.style.width = `${Math.min(naturalWidth, width)}px`;
    }
    measured.set(bubble, { text, available, font });
  }
}
