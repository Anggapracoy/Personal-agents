/** Keep WebKit's focus reveal from panning the native shell a second time. */
export function attachConversationInputFocus(page: HTMLElement) {
  const doc = page.ownerDocument;
  const win = doc.defaultView;
  if (!win || !(win as Window & { __decisionFeedNativeShell?: boolean }).__decisionFeedNativeShell) return () => {};
  const isEditor = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement =>
    target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement
      && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type));
  let restoreFrame = 0;
  let revealFrame = 0;
  let hidden: HTMLInputElement | HTMLTextAreaElement | null = null;
  let previousOpacity = '';
  const keyboardOpen = () => (win.visualViewport?.height ?? win.innerHeight) < win.innerHeight - 80;
  const reveal = () => {
    const input = doc.activeElement;
    if (!keyboardOpen() || !isEditor(input)
      || !page.contains(input) || !input.closest('.wd-card')) return;
    const bounds = page.getBoundingClientRect();
    const top = Math.max(bounds.top, page.querySelector('.wd-taskbar')?.getBoundingClientRect().bottom ?? bounds.top) + 8;
    const bottom = bounds.bottom - parseFloat(win.getComputedStyle(page).paddingBottom || '0') - 8;
    const field = (input.closest('fieldset') ?? input.closest('label'))?.getBoundingClientRect();
    const target = field && field.height <= bottom - top ? field : input.getBoundingClientRect();
    // Reveal within the conversation only, keeping the question label when it fits.
    if (target.top < top) page.scrollTop += target.top - top;
    else if (target.bottom > bottom) page.scrollTop += target.bottom - bottom;
  };
  const scheduleReveal = () => {
    win.cancelAnimationFrame(revealFrame);
    revealFrame = win.requestAnimationFrame(reveal);
  };
  const resize = new ResizeObserver(scheduleReveal);
  resize.observe(page);
  win.visualViewport?.addEventListener('resize', scheduleReveal);
  const restore = () => {
    if (hidden) hidden.style.opacity = previousOpacity;
    hidden = null;
    scheduleReveal();
  };
  const pointerDown = (event: PointerEvent) => {
    const input = event.target;
    if (!isEditor(input)
      || !input.closest('.wd-card') || input.disabled || input.readOnly || event.button !== 0) return;
    // Preserve ordinary caret positioning and text selection while editing.
    if (doc.activeElement === input && keyboardOpen()) return;
    event.preventDefault();
    win.cancelAnimationFrame(restoreFrame);
    restore();
    hidden = input;
    previousOpacity = input.style.opacity;
    input.style.opacity = '0';
    // An autoFocused field can be active without having opened the keyboard.
    if (doc.activeElement === input) input.blur();
    input.focus({ preventScroll: true });
    restoreFrame = win.requestAnimationFrame(restore);
  };
  page.addEventListener('pointerdown', pointerDown);
  return () => {
    page.removeEventListener('pointerdown', pointerDown);
    resize.disconnect();
    win.visualViewport?.removeEventListener('resize', scheduleReveal);
    win.cancelAnimationFrame(restoreFrame);
    restore();
    win.cancelAnimationFrame(revealFrame);
  };
}
