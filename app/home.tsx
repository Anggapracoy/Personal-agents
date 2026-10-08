"use client";
import { FirstSuggestionHint } from "./first-suggestion-hint";
import { FeedTaskIcon } from "./feed-task-icon";
import { GoogleConnectionNotice } from "./google-connection-notice";
import { useNativeHomeHeader } from "./native-home-header";
import { ToolActivityIndicator } from "./tool-activity";
import { attachPullToRefresh, REFRESH_THRESHOLD, type RefreshState } from "./pull-to-refresh";
import { attachRowSwipe } from "./row-swipe";
import { ProfileAvatar } from "./profile-avatar";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mascot, TaskIcon, type IconKind, type IconState } from "./task-icon";
import { confirmConversationArchive, postNativeMessage, type NativeWindow } from './native-bridge';
import type { ConversationAction } from '../lib/conversation-settings';

export type HomeItem = { feedQuestion?: { actionId: string; questionId: string; multiple?: boolean; moreOptions: boolean }; avatar?: import("../lib/conversation-settings").ConversationAvatar; waiting?: boolean; activity?: import("../lib/harness/tool-activity-icons").ToolActivity; proactive?: { personalized?: boolean; alternative?: { id: string; label: string }; context: string; body: string; option?: { id: string; label: string } }; id: string; runId?: string; preview?: { kind: 'user' | 'agent'; text: string }[]; unread?: boolean; unreadCount?: number; messageAt?: string; key?: string; pinnedAt?: string | null; archived?: boolean; title: string; line: string; kind: IconKind; state: IconState; time?: string; ask?: string };
export function BackIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5-7 7 7 7" /></svg>; }
function ArchiveIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6" /></svg>; }
export function Row({ item, onOpen, onMenu, onArchive, enabled = false }: { item: HomeItem; onOpen: () => void; onMenu?: (item: HomeItem) => void; onArchive?: () => Promise<boolean>; enabled?: boolean }) {
  const wrapper = useRef<HTMLDivElement>(null), front = useRef<HTMLButtonElement>(null), action = useRef<HTMLButtonElement>(null);
  const callback = useRef(onArchive); callback.current = onArchive;
  useEffect(() => {
    if (!wrapper.current || !front.current || !action.current || !onArchive) return;
    return attachRowSwipe(wrapper.current, front.current, action.current, () => callback.current!(), () => item.archived ? Promise.resolve(true) : confirmConversationArchive(wrapper.current!));
  }, [Boolean(onArchive), item.archived]);
  return (
    <div ref={wrapper} className="wd-swipe-row" data-swipe="closed">
      <button ref={action} type="button" className="wd-swipe-action" disabled={!enabled} aria-label={`${item.archived ? "Unarchive" : "Archive"} ${item.title}`}><span className="wd-swipe-symbol"><ArchiveIcon /></span><span className="wd-swipe-action-label">{item.archived ? "Unarchive" : "Archive"}</span></button>
    <button ref={front} type="button" className={`wd-row${item.unread ? " is-unread" : ""}`} data-conversation-key={item.key} onClick={onOpen} onContextMenu={onMenu ? event => { event.preventDefault(); onMenu(item); } : undefined}>
      <span className="wd-unread-slot">{item.unread && <span className="wd-unread-dot" aria-label="Unread message" />}</span>
      <FeedTaskIcon avatar={item.avatar} conversationId={item.key ?? item.id} kind={item.kind} size={64} />
      <span className="wd-row-body">
        <span className="wd-row-top"><strong>{item.title}</strong>{item.time && <time>{item.time}</time>}<svg className="wd-row-chevron" width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true"><path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        {item.activity ? <span className={`wd-row-activity${item.waiting ? " is-waiting" : ""}`}><ToolActivityIndicator {...item.activity} /></span> : <span className="wd-row-preview"><span className="wd-row-line">{item.line}</span></span>}
        {item.state === "need" && <span className="wd-answer-needed"><span className="wd-conversation-dot" />Needs your answer</span>}
      </span>
    </button>
    </div>
  );
}

export function ProactiveRow({ item, onOpen, onChoose, onAlternative, enabled, onMenu, onArchive }: { item: HomeItem; onOpen: () => void; onChoose?: (selectedOptionIds?: string[]) => Promise<boolean>; onAlternative?: () => Promise<boolean>; enabled: boolean; onMenu: (item: HomeItem) => void; onArchive?: () => Promise<boolean> }) {
  const wrapper = useRef<HTMLDivElement>(null), front = useRef<HTMLElement>(null), archiveAction = useRef<HTMLButtonElement>(null);
  const archiveCallback = useRef(onArchive); archiveCallback.current = onArchive;
  useEffect(() => {
    if (!wrapper.current || !front.current || !archiveAction.current || !onArchive) return;
    return attachRowSwipe(wrapper.current, front.current, archiveAction.current, () => archiveCallback.current!(), () => item.archived ? Promise.resolve(true) : confirmConversationArchive(wrapper.current!));
  }, [Boolean(onArchive), item.archived]);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<boolean>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { if (!await action()) setError('Couldn’t save that. Try again.'); }
    catch { setError('Couldn’t save that. Try again.'); }
    finally { lock.current = false; setPending(false); }
  };
  return <div ref={wrapper} className="wd-swipe-row wd-proactive-swipe" data-swipe="closed" data-pending={pending || undefined}>
    <button ref={archiveAction} type="button" className="wd-swipe-action" disabled={!enabled || pending || !onArchive} aria-label={`Archive ${item.title}`}><span className="wd-swipe-symbol"><ArchiveIcon /></span><span className="wd-swipe-action-label">Archive</span></button>
    <article ref={front} className="wd-proactive-item">
    <button type="button" className="wd-proactive-avatar" aria-label={`Open ${item.title}`} onClick={onOpen} onContextMenu={event => { event.preventDefault(); onMenu(item); }}><FeedTaskIcon avatar={item.avatar} conversationId={item.key ?? item.id} kind={item.kind} size={44} /></button>
    <div className="wd-proactive-content">
      <button type="button" className="wd-proactive-text" data-conversation-key={item.key} onClick={onOpen} onContextMenu={event => { event.preventDefault(); onMenu(item); }}><span className="wd-proactive-heading"><h2>{item.title}</h2>{item.proactive!.personalized && <span className="wd-for-you">For you</span>}</span><p>{item.proactive!.body}</p></button>
      <div className="wd-proactive-actions">
      {item.feedQuestion?.multiple ? <>
        {[item.proactive!.option, item.proactive!.alternative].filter(Boolean).map(option => <button key={option!.id} type="button" className={selected.includes(option!.id) ? "wd-proactive-cta" : "wd-proactive-alternative"} aria-pressed={selected.includes(option!.id)} disabled={pending || !enabled} onClick={() => setSelected(current => current.includes(option!.id) ? current.filter(id => id !== option!.id) : [...current, option!.id])}>{option!.label}</button>)}
        <button type="button" className="wd-proactive-cta" disabled={pending || !enabled || !selected.length} onClick={() => onChoose && void run(() => onChoose(selected))}>Done</button>
      </> : <><button type="button" className="wd-proactive-cta" disabled={pending || (Boolean(onChoose) && !enabled)} onClick={() => onChoose ? void run(onChoose) : onOpen()}><span>{pending ? 'One moment…' : item.proactive!.option?.label ?? 'Open conversation'}</span></button>
        {item.proactive!.alternative && onAlternative && <button type="button" className="wd-proactive-alternative" disabled={pending || !enabled} onClick={() => void run(onAlternative)}><span>{item.proactive!.alternative.label}</span></button>}
        </>}
        {item.feedQuestion?.moreOptions && <button type="button" className="wd-proactive-alternative" onClick={onOpen}>More choices</button>}
      </div>
      {error && <p className="wd-conversation-error" role="alert">{error}</p>}
    </div>
  </article></div>;
}


export function Home({ firstUse = false, suggestionHintPreview = false, ownerEmail, googleConnections, initial, name: userName, image, items, scanning, emptyFirstScan, onSuggest, onOpen, onYou, archived = false, onArchive, onBack, active = true, nativeChromeActive = active, previewMode = false, onAction, onChoose, actionsReady = false, actionError, pendingInitialData = false, onRefresh }: {
  firstUse?: boolean;
  suggestionHintPreview?: boolean;
  ownerEmail?: string;
  googleConnections?: import("./workspace-model").GoogleConnection[];
  initial: string; name?: string | null; image?: string | null; items: HomeItem[]; scanning?: string | null; emptyFirstScan?: string | null; onSuggest?: (draft: string) => void;
  onRefresh?: () => Promise<void>; pendingInitialData?: boolean; archived?: boolean; onArchive?: () => void; onBack?: () => void;
  onOpen: (item: HomeItem) => void; onYou: () => void; active?: boolean; nativeChromeActive?: boolean; previewMode?: boolean;
  onChoose?: (item: HomeItem, optionId: string, selectedOptionIds?: string[]) => Promise<boolean>;
  onAction?: (action: ConversationAction) => Promise<boolean>; actionsReady?: boolean; actionError?: string;
}) {
  const showEmptyScan = Boolean(emptyFirstScan && !scanning);
  const [visibleCount, setVisibleCount] = useState(30);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  // Titles and previews match instantly; the server also searches every message, receipts and file names.
  const [remoteSearch, setRemoteSearch] = useState<{ query: string; matches: Record<string, string> }>({ query: "", matches: {} });
  useEffect(() => {
    const q = query.trim();
    if (previewMode || q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/conversations/search?q=${encodeURIComponent(q)}`, { cache: "no-store", signal: controller.signal })
        .then(response => response.ok ? response.json() as Promise<{ matches: { key: string; snippet: string }[] }> : { matches: [] })
        .then(data => setRemoteSearch({ query: q.toLocaleLowerCase(), matches: Object.fromEntries(data.matches.map(match => [match.key, match.snippet])) }))
        .catch(() => { if (!controller.signal.aborted) setRemoteSearch({ query: q.toLocaleLowerCase(), matches: {} }); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, previewMode]);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchReveal = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (searching) searchInput.current?.focus({ preventScroll: true }); }, [searching]);
  const [nativeMenus, setNativeMenus] = useState(false);
  const [menu, setMenu] = useState<HomeItem | null>(null);
  const [rename, setRename] = useState<HomeItem | null>(null);
  const [name, setName] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const firstArrivalPending = useRef(false);
  const firstArrivalAnimation = useRef<Animation | null>(null);
  const arrivalStatusAnimation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const home = root.current;
    if (!home || archived || !active || searching || actionError || pendingInitialData) {
      firstArrivalPending.current = false;
      firstArrivalAnimation.current?.cancel();
      arrivalStatusAnimation.current?.cancel();
      return;
    }
    const visibleItems = items.filter(item => !item.archived);
    if (!visibleItems.length) {
      if (scanning) firstArrivalPending.current = true;
      return;
    }
    if (!firstArrivalPending.current) return;
    firstArrivalPending.current = false;
    const row = home.querySelector<HTMLElement>('.wd-proactive-swipe');
    if (!row) return;
    const homeBounds = home.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const rise = Math.max(0, homeBounds.top + homeBounds.height * 0.44 - rowBounds.top);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    firstArrivalAnimation.current = row.animate(
      reduceMotion
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ transform: `translateY(${rise}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: reduceMotion ? 120 : 360, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
    arrivalStatusAnimation.current = home.querySelector('.wd-scan-ongoing')?.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { delay: reduceMotion ? 120 : 360, duration: 120, fill: 'backwards' },
    ) ?? null;
  }, [items, scanning, archived, active, searching, actionError, pendingInitialData]);
  useEffect(() => () => {
    firstArrivalAnimation.current?.cancel();
    arrivalStatusAnimation.current?.cancel();
  }, []);
  const [refreshState, setRefreshState] = useState<RefreshState>({ distance: 0, refreshing: false, error: '' });
  const refreshIndicator = useRef<HTMLDivElement>(null);
  const indicatorAnimation = useRef<Animation | null>(null);
  const previousDistance = useRef(0);
  useLayoutEffect(() => {
    const node = refreshIndicator.current;
    if (!node) return;
    const from = indicatorAnimation.current ? node.getBoundingClientRect().height : previousDistance.current;
    indicatorAnimation.current?.cancel();
    if ((refreshState.refreshing || refreshState.distance === 0) && from !== refreshState.distance && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      indicatorAnimation.current = node.animate([{ height: `${from}px` }, { height: `${refreshState.distance}px` }], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
      indicatorAnimation.current.onfinish = () => { indicatorAnimation.current = null; };
    } else indicatorAnimation.current = null;
    previousDistance.current = refreshState.distance;
  }, [refreshState.distance, refreshState.refreshing]);
  useEffect(() => () => indicatorAnimation.current?.cancel(), []);
  const refreshCallback = useRef(onRefresh); refreshCallback.current = onRefresh;
  const refreshControl = useRef<ReturnType<typeof attachPullToRefresh> | null>(null);
  useEffect(() => {
    if (!active || archived || !onRefresh || !root.current || menu || rename) return;
    const control = attachPullToRefresh(root.current, () => refreshCallback.current!(), setRefreshState);
    refreshControl.current = control;
    return () => { control.dispose(); refreshControl.current = null; setRefreshState({ distance: 0, refreshing: false, error: '' }); };
  }, [active, archived, Boolean(onRefresh), Boolean(menu), Boolean(rename)]);
  const lastPointerDown = useRef(-Infinity);
  const closeSearch = () => { setSearching(false); setQuery(""); setVisibleCount(30); };
  const needle = query.trim().toLocaleLowerCase();
  const matches = items.flatMap(item => {
    if (Boolean(item.archived) !== archived) return [];
    if (`${item.title} ${item.line}`.toLocaleLowerCase().includes(needle)) return [item];
    const snippet = item.key ? remoteSearch.matches[item.key] : undefined;
    return snippet ? [{ ...item, line: snippet, activity: undefined }] : [];
  });
  const searchPending = needle.length >= 2 && !previewMode && remoteSearch.query !== needle;
  const proactive = archived ? [] : matches.filter(item => item.proactive && !item.pinnedAt);
  const pins = archived ? [] : matches.filter(item => item.pinnedAt).sort((a, b) => a.pinnedAt!.localeCompare(b.pinnedAt!) || a.id.localeCompare(b.id));
  const rows = archived ? matches : matches.filter(item => !item.pinnedAt && !item.proactive);
  const archivedCount = items.filter(item => item.archived).length;
  const header = useRef<HTMLElement>(null);
  const { native: nativeHeader, nativeAvatar } = useNativeHomeHeader(header, nativeChromeActive, archived, searching, archivedCount, image, initial);
  const menuArchivePending = useRef(false);
  const menuAction = useCallback(async (action: ConversationAction) => {
    if (action.action === 'archive') {
      if (menuArchivePending.current) return;
      const selected = [...(root.current?.querySelectorAll<HTMLElement>('[data-conversation-key]') ?? [])].find(node => node.dataset.conversationKey === action.key);
      const source = selected?.closest<HTMLElement>('.wd-swipe-row') ?? selected;
      if (!source) return;
      menuArchivePending.current = true;
      try {
        // Let the web menu disappear before anchoring the shared confirmation.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!source.isConnected || !await confirmConversationArchive(source) || !source.isConnected) return;
        await onAction?.(action);
      } finally { menuArchivePending.current = false; }
    } else await onAction?.(action);
  }, [onAction]);
  useEffect(() => { setNativeMenus(Boolean((window as NativeWindow).__decisionFeedNativeConversationMenus)); }, []);
  useEffect(() => {
    if (!nativeMenus || !active) return;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<ConversationAction | { key: string; action: 'open' }>).detail;
      if (detail?.action === 'open') { const item = items.find(item => item.key === detail.key); if (item) onOpen(item); return; }
      if (actionsReady && items.some(item => item.key === detail?.key)) void menuAction(detail);
    };
    window.addEventListener('decisionFeed:conversationAction', receive);
    return () => window.removeEventListener('decisionFeed:conversationAction', receive);
  }, [nativeMenus, active, items, menuAction, onOpen, actionsReady]);
  useEffect(() => {
    if (!nativeMenus) return;
    let frame = 0;
    const publish = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const elements = active ? [...(root.current?.querySelectorAll<HTMLElement>('[data-conversation-key]') ?? [])] : [];
        const descriptors = elements.flatMap(element => {
          const item = items.find(item => item.key === element.dataset.conversationKey);
          // Suggestions are composed of separate text and option buttons, but
          // their native lift must use one complete surface like regular chats.
          const rect = (element.closest<HTMLElement>('.wd-proactive-item') ?? element).getBoundingClientRect();
          if (!item || rect.bottom <= 0 || rect.top >= window.innerHeight) return [];
          return [{ key: item.key, title: item.title, pinned: Boolean(item.pinnedAt), archived: Boolean(item.archived), enabled: actionsReady && element.closest<HTMLElement>('.wd-swipe-row')?.dataset.swipe !== 'open', unread: Boolean(item.unread), through: item.messageAt, runId: previewMode ? undefined : item.runId, preview: item.preview,
            x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
        });
        postNativeMessage({ version: 1, action: 'conversationMenuItems', payload: { items: descriptors, swipeActive: Boolean(root.current?.querySelector('.wd-swipe-row[data-swipe="open"]')), viewportWidth: window.innerWidth } });
      });
    };
    publish();
    const observer = new ResizeObserver(publish); if (root.current) observer.observe(root.current); if (searchReveal.current) observer.observe(searchReveal.current);
    root.current?.addEventListener('scroll', publish, { passive: true }); root.current?.addEventListener('conversationSwipe', publish); window.addEventListener('resize', publish);
    const node = root.current;
    return () => { cancelAnimationFrame(frame); observer.disconnect(); node?.removeEventListener('scroll', publish); node?.removeEventListener('conversationSwipe', publish); window.removeEventListener('resize', publish); postNativeMessage({ version: 1, action: 'conversationMenuItems', payload: { items: [], viewportWidth: window.innerWidth } }); };
  }, [nativeMenus, active, items, archived, searching, query, visibleCount, actionsReady, previewMode]);
  const openMenu = (item: HomeItem) => { if (!nativeMenus && actionsReady) setMenu(item); };
  const act = (action: ConversationAction) => { setMenu(null); void menuAction(action); };

  return (
    <div ref={root} onPointerDownCapture={() => { lastPointerDown.current = performance.now(); }} className="wd-screen wd-home compact-feed" data-active={active} data-native-conversation-menu={nativeMenus || undefined}>
      <div className="wd-feed-header">
      <header ref={header} data-native-home-avatar={nativeAvatar || undefined} className={`wd-topbar${nativeHeader ? " has-native-home-header" : ""}`}>
        {archived ? <button data-home-action="back" className="wd-round" aria-label="Back to conversations" onClick={onBack}><BackIcon /></button> : <button type="button" data-home-profile className="wd-round wd-home-profile" aria-label="You" onClick={onYou}><span className="wd-avatar"><ProfileAvatar image={image} initial={initial} /></span></button>}
        {archived && <strong className="wd-archive-title">Archived</strong>}
        <div className="wd-home-controls">
          {!archived && <button data-home-action="archive" className="wd-round" aria-label={`Archived conversations (${archivedCount})`} onClick={onArchive}><ArchiveIcon /></button>}
          <button type="button" data-home-action="search" className="wd-round" aria-label={searching ? "Close search" : "Search conversations"} aria-expanded={searching} onClick={() => { if (searching) closeSearch(); else setSearching(true); }}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">{searching ? <path d="m6 6 12 12M18 6 6 18" /> : <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}</svg></button>
        </div>
      </header>
      </div>
      <div className="wd-feed-content">
      {!archived && <GoogleConnectionNotice active={active} previewMode={previewMode} initialAccounts={googleConnections} />}
      {onRefresh && !archived && <>
        <button type="button" className="wd-refresh-accessible" onClick={() => void refreshControl.current?.refresh()} disabled={refreshState.refreshing}>Refresh conversations</button>
        <div ref={refreshIndicator} className="wd-pull-refresh" style={{ height: refreshState.distance }} aria-hidden="true">
          <span className={`wd-refresh-spinner${refreshState.refreshing ? ' is-refreshing' : ''}`} style={{ opacity: Math.min(1, refreshState.distance / REFRESH_THRESHOLD), transform: refreshState.refreshing ? undefined : `rotate(${refreshState.distance * 4}deg)` }}>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 30}deg) translateY(-8px)`, opacity: (i + 1) / 12, animationDelay: `${-0.7 + i * 0.7 / 12}s` }} />)}</span>
        </div>
        <span className="wd-sr-only" role="status">{refreshState.refreshing ? 'Refreshing conversations' : refreshState.distance >= REFRESH_THRESHOLD ? 'Release to refresh' : ''}</span>
        {refreshState.error && <p className="wd-conversation-error" role="alert">{refreshState.error}</p>}
      </>}
      <div ref={searchReveal} className={`wd-home-search-reveal${searching ? " is-open" : ""}`} aria-hidden={!searching}><div className="wd-home-search-clip"><input ref={searchInput} disabled={!searching} className="wd-home-search" type="search" enterKeyHint="done" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); closeSearch(); } }} onBlur={(event) => { if (!event.relatedTarget && performance.now() - lastPointerDown.current > 150) closeSearch(); }} aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(30); }} /></div></div>
      {actionError && <p className="wd-conversation-error" role="alert">{actionError}</p>}
      {pins.length > 0 && <div className="wd-pinned-conversations" aria-label="Pinned conversations">
        {pins.map(item => <button type="button" key={item.key} className="wd-pinned-conversation" data-conversation-key={item.key} aria-label={`${item.title}, pinned${item.unread ? ", unread message" : ""}${item.state === 'need' ? ', needs your attention' : ''}`} onClick={() => onOpen(item)} onContextMenu={event => { event.preventDefault(); openMenu(item); }}>
          <span className="wd-pinned-avatar">{item.unread && <span className="wd-unread-dot" aria-label="Unread message" />}<FeedTaskIcon avatar={item.avatar} conversationId={item.key ?? item.id} kind={item.kind} size={104} />{item.state === 'need' && <span className="wd-conversation-dot" />}</span>
          <span className="wd-pinned-name">{item.title}</span>
        </button>)}
      </div>}
      <FirstSuggestionHint preview={suggestionHintPreview} ownerEmail={ownerEmail} eligible={active && !archived && !query && proactive.length > 0 && !pendingInitialData} />
      {proactive.length > 0 && <div className="wd-proactive-items">{proactive.map(item => <ProactiveRow key={item.key ?? item.id} item={item} onOpen={() => onOpen(item)} onMenu={openMenu} onArchive={onAction && item.key ? () => onAction({ key: item.key!, action: "archive" }) : undefined} enabled={active && actionsReady} onAlternative={onChoose && item.proactive?.alternative ? () => onChoose(item, item.proactive!.alternative!.id) : undefined} onChoose={onChoose && item.proactive?.option ? (selectedOptionIds) => onChoose(item, item.proactive!.option!.id, selectedOptionIds) : undefined} />)}</div>}
      <div className="wd-list wd-conversations" aria-label={archived ? 'Archived conversations' : 'Conversations'}>
        {rows.slice(0, visibleCount).map((item) => <Row key={item.id} item={item} onOpen={() => onOpen(item)} onMenu={openMenu} enabled={active && actionsReady && Boolean(item.key)} onArchive={onAction && item.key ? () => onAction({ key: item.key!, action: item.archived ? 'unarchive' : 'archive' }) : undefined} />)}
      </div>
      {!archived && !query && scanning && matches.length > 0 && <div className="wd-scan-ongoing" role="status">
        <Mascot size={28} className="wd-search-mascot" />
        <span>Still looking…</span>
      </div>}
      {rows.length > visibleCount && <button type="button" className="wd-more-conversations" onClick={() => setVisibleCount((count) => count + 30)}>Show older conversations</button>}
      {query && matches.length === 0 && <p className="wd-empty wd-search-empty" role="status">{searchPending ? "Searching messages…" : "No conversations found."}</p>}
      {!pendingInitialData && !actionError && !query && matches.length === 0 && <>
        <div className={firstUse && !archived ? "wd-guided-starts" : `wd-empty${archived ? " wd-archive-empty" : (scanning || showEmptyScan || firstUse) ? " wd-scan-empty" : " wd-home-idle-empty"}`}>
          {!archived && firstUse ? <div className="wd-first-use">
            <div className="wd-first-use-question"><span className="wd-first-use-avatar" aria-hidden="true"><Mascot size={30} /></span><div className="wd-first-use-message"><span className="wd-first-use-sender">Dash</span><p>What’s one thing you need to get done this week?</p></div></div>

          </div> : !archived && scanning ? <>
            <div className="wd-first-task-mascot" aria-hidden="true"><Mascot size={72} /></div>
            <h2>I’m checking what needs attention.</h2>
            <p>Anything useful I find will appear here.</p>
          </> : !archived && showEmptyScan ? <div className="wd-scan-complete" role="status"><h2>You’re all caught up.</h2><p>Have something else in mind? Message me below.</p></div> : <p>{archived ? 'None archived' : 'Message your assistant below. Your conversations will stay here.'}</p>}
        </div>
        {!archived && scanning && !firstUse && <p className="wd-scan-composer-hint">Have something in mind? Message me below.</p>}
      </>}
      </div>
      {menu && !nativeMenus && <div className="wd-conversation-menu-backdrop" onClick={() => setMenu(null)}><div className="wd-conversation-peek" onClick={event => event.stopPropagation()}><ConversationPreview item={menu} previewMode={previewMode} onOpen={() => { setMenu(null); onOpen(menu); }} /><div className="wd-conversation-menu" role="menu" aria-label={menu.title} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setMenu(null); }}>
        <button role="menuitem" autoFocus onClick={() => act(menu.unread ? { key: menu.key!, action: 'read', through: menu.messageAt ?? new Date().toISOString() } : { key: menu.key!, action: 'unread' })}>{menu.unread ? 'Mark as read' : 'Mark as unread'}</button>
        <button role="menuitem" onClick={() => act({ key: menu.key!, action: menu.pinnedAt ? 'unpin' : 'pin' })}>{menu.pinnedAt ? 'Unpin' : 'Pin'}</button>
        <button role="menuitem" onClick={() => { setRename(menu); setName(menu.title); setMenu(null); }}>Rename</button>
        <button role="menuitem" onClick={() => act({ key: menu.key!, action: menu.archived ? 'unarchive' : 'archive' })}>{menu.archived ? 'Unarchive' : 'Archive'}</button>
      </div></div></div>}
      {rename && <div className="wd-conversation-menu-backdrop"><form className="wd-conversation-rename" role="dialog" aria-modal="true" aria-label="Rename conversation" onSubmit={async event => { event.preventDefault(); if (name.trim() && await onAction?.({ key: rename.key!, action: 'rename', title: name.trim() })) setRename(null); }}>
        <label htmlFor="conversation-name">Rename conversation</label><input id="conversation-name" autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} />
        <div><button type="button" onClick={() => setRename(null)}>Cancel</button><button disabled={!name.trim() || !actionsReady}>Save</button></div>
      </form></div>}
    </div>
  );
}

function ConversationPreview({ item, previewMode, onOpen }: { item: HomeItem; previewMode: boolean; onOpen: () => void }) {
  const [messages, setMessages] = useState(item.preview ?? []);
  const [failed, setFailed] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMessages(item.preview ?? []); setFailed(false);
    if (!item.runId || previewMode) return;
    const controller = new AbortController();
    void fetch(`/api/runs/${encodeURIComponent(item.runId)}/messages`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Preview unavailable'); return response.json(); })
      .then(data => setMessages(data.items.filter((message: { kind: string; text?: string }) => (message.kind === 'user' || message.kind === 'agent') && typeof message.text === 'string').slice(-12)))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [item, previewMode]);
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [messages]);
  return <section className="wd-conversation-preview" aria-label="Conversation preview">
    <button className="wd-preview-header" onClick={onOpen}><FeedTaskIcon avatar={item.avatar} conversationId={item.key ?? item.id} kind={item.kind} size={36} /><strong>{item.title}</strong><span>Open</span></button>
    <div ref={body} className="wd-preview-messages">{messages.map((message, index) => <p key={index} className={`wd-preview-bubble is-${message.kind}`}>{message.text}</p>)}{failed && <small>Couldn’t refresh preview. Open conversation to try again.</small>}</div>
  </section>;
}

/** Compact greeting shared by the normal feed and local preview. */
