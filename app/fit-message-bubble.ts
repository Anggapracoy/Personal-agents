/** CSS shrink-to-fit keeps the whole wrapping width; use the longest laid-out line instead. */
export function fitMessageBubble(bubble: HTMLElement) {
  bubble.style.removeProperty('width');
  const range = document.createRange();
  range.selectNodeContents(bubble);
  const lines = Array.from(range.getClientRects());
  if (!lines.length) return;
  const style = getComputedStyle(bubble);
  const inset = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const current = bubble.getBoundingClientRect().width;
  const fitted = Math.min(current, Math.ceil(Math.max(...lines.map(line => line.width)) + inset + 1));
  if (current - fitted > 1) bubble.style.width = `${fitted}px`;
}
