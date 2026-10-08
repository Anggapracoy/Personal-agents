const anchors = new WeakMap<HTMLElement, () => boolean>();
/** Read the pre-layout anchor, so newly appended content cannot look like a user scroll. */
export function conversationIsPinned(page: HTMLElement) { return anchors.get(page)?.() ?? true; }

/** Keep the bottom message above changing keyboard/composer insets without fighting reading. */
export function attachConversationViewport(page: HTMLElement) {
  let height = page.clientHeight;
  let extent = page.scrollHeight;
  let pinned = extent - height - page.scrollTop < 80;
  anchors.set(page, () => pinned);
  const scroll = () => {
    // Resize can emit a scroll before ResizeObserver; preserve the pre-resize anchor.
    const atBottom = page.scrollHeight - page.clientHeight - page.scrollTop < 80;
    if (atBottom || (height === page.clientHeight && extent === page.scrollHeight)) pinned = atBottom;
  };
  const resize = new ResizeObserver(() => {
    if (pinned) page.scrollTop = page.scrollHeight - page.clientHeight;
    height = page.clientHeight;
    extent = page.scrollHeight;
  });
  resize.observe(page);
  // Link metadata and images can grow after the message itself is rendered.
  const thread = page.querySelector<HTMLElement>(".wd-thread");
  if (thread) resize.observe(thread);
  page.addEventListener('scroll', scroll, { passive: true });
  return () => { anchors.delete(page); resize.disconnect(); page.removeEventListener('scroll', scroll); };
}
