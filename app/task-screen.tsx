"use client";
import { QuestionsCard } from "./approvals";
import { InlinePanelContent } from "./inline-panel";
import { ChoiceReceipt } from "./choice-options";
import { createPortal } from "react-dom";
import type { DetailsOrigin } from "./conversation-details-motion";
import { ConversationDetails } from "./conversation-details";
import { ConversationDetailsContext } from "./conversation-details-context";
import { QuotedReply } from "./quoted-reply";
import { attachmentPreview } from "./attachment-preview";
import { fileDescription } from "../lib/file-display";
import { MessageWhy } from "./message-why";
import { TimelinePanel } from "./inline-panel";
import { inlineTimeline, reconcileInlineRecords, type InlinePanel, type InlineRecord } from "./inline-timeline";
import { combineMessageResults } from "../lib/message-results";
import { AnswersSummary, CompletedCall, WaitReceipt } from "./conversation-status";
import { animateIncomingMessage } from "./incoming-message-motion";
import { animateMessageSend, hasPendingMessageSend } from "./message-send-motion";
import { fitMessageBubble } from "./fit-message-bubble";
import { receiveMessageFeedback } from "./message-feedback";
import { MessageMarkdown } from "./message-markdown";
import { ResultBlocks } from "./result-blocks";
import { MessageReaction } from "./message-reaction";
import { attachConversationInputFocus } from "./conversation-input-focus";
import { attachConversationViewport, conversationIsPinned } from "./conversation-viewport";
import { attachMessageGradient, paintMessageGradient } from "./message-gradient";
import { attachBubbleMotion } from "./bubble-motion";
import { ToolActivityIndicator } from "./tool-activity";
import { ACTIVITY_ICONS, type ActivityIconName } from "../lib/harness/tool-activity-icons";
import { useNativeChatHeader } from "./native-chat-header";
import { groupMessageTimes, messageTimeLabel, sameMessageGroup } from "./message-time";
import { VideoMessage } from "./video-message";
import { PhotoMessage } from "./photo-message";
import { FileMessage } from "./file-message";
import { Children, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentFollowUpAction, AgentResult } from "../lib/harness/types";
import type { ThreadItem } from "../lib/harness/thread";
import type { DecisionOption } from "../lib/types";
import { BackIcon } from "./home";
import { TaskIcon, type IconKind, type IconState } from "./task-icon";
import { sharedLocationAccuracy, sharedLocationUrl, splitLocationMessage } from "../lib/shared-location";

export type AskPhase = {
  headline: string;
  createdAt?: string;
  sub: string;
  why: string[];
  options: DecisionOption[];
  dismissLabel: string;
  busyOptionId?: string | null;
  selectedOptionId?: string;
  onChoose: (option: DecisionOption) => void;
  onDismiss: () => void;
  onCalendar?: () => void;
};

function ProactiveChoices({ask}:{ask:AskPhase}) {
 const selected=ask.options.find(option=>option.id===ask.selectedOptionId);
 const busy=Boolean(ask.busyOptionId);
 const primary=ask.options.find(option=>option.isPrimary)??ask.options[0];
 const ordered=[primary,...ask.options.filter(option=>option!==primary)].filter(Boolean);
 return <InlinePanelContent preserveBubble active={!selected}>{selected ? <ChoiceReceipt pending={busy} answers={[{question:"What would you like to do?",answer:selected.label,choice:true,selectedOptions:[{label:selected.label}]}]}/> : <div className="wd-card wd-inline-card wd-proactive-choices">
  <header className="wd-inline-header"><strong>{ask.sub?ask.headline:"What would you like to do?"}</strong>{ask.why[0]&&<small>{ask.why[0]}</small>}</header>
  <div className="wd-card-actions">
   {ordered.map(option=><button type="button" key={option.id} className={`wd-btn ${option===primary?"is-primary":"is-secondary"}`} disabled={busy} aria-busy={ask.busyOptionId===option.id} onClick={()=>ask.onChoose(option)}>{ask.busyOptionId===option.id?<span className="wd-spinner" aria-hidden="true" />:null}<span>{option.label}</span></button>)}
   <button type="button" className="wd-btn is-secondary" disabled={busy} onClick={ask.onDismiss}>{ask.dismissLabel}</button>
  </div>
  {ask.onCalendar&&<button type="button" className="wd-btn is-text wd-inline-link" onClick={ask.onCalendar}>See my day</button>}
 </div>}</InlinePanelContent>;
}

const inlineHistory = new Map<string, InlineRecord[]>();
function savedInlineHistory(id: string): InlineRecord[] {
  if (inlineHistory.has(id)) return inlineHistory.get(id)!;
  if (typeof window === "undefined") return [];
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(`Dash:inline:${id}`) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is InlineRecord => item && typeof item.id === "string" && typeof item.summary === "string" && typeof item.createdAt === "string" && (item.afterId === undefined || typeof item.afterId === "string") && (item.replaces === undefined || typeof item.replaces === "string")) : [];
  } catch { return []; }
}

function MessageReceipt({ item, isPrevious = false }: { item: Extract<ThreadItem, { kind: "user" }>; isPrevious?: boolean }) {
  const state = item.readAt ? "read" : item.deliveredAt ? "delivered" : item.deliveryState === "sending" ? "sending" : item.deliveryState === "failed" ? "failed" : "sent";
  const receipt = useRef<HTMLSpanElement>(null);
  const newReceipt = useRef(state === "sending");
  const [pending, setPending] = useState(newReceipt.current);
  useEffect(() => {
    if (!pending) return;
    let timer: number;
    const reveal = () => {
      if (receipt.current?.closest<HTMLElement>(".wd")?.dataset.sendingMessage) {
        timer = window.setTimeout(reveal, 16);
      } else setPending(false);
    };
    timer = window.setTimeout(reveal, 650);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const previous = useRef(state);
  const animate = state === "sending" || previous.current !== state || newReceipt.current;
  useLayoutEffect(() => { previous.current = state; }, [state]);
  return <span ref={receipt} className={`wd-message-receipt${pending ? " is-pending" : ""}${isPrevious ? " is-previous" : ""}${state === "failed" ? " is-failed" : ""}`}>
    <span key={state} className={`wd-receipt-label is-${state}${animate ? " is-animated" : ""}`}>
      {state === "read" ? <>Read <time dateTime={item.readAt}>{new Date(item.readAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time></> :
        state === "delivered" ? "Delivered" : state === "sending" ? "Sending…" : state === "failed" ? "Failed" : "Sent"}
    </span>
  </span>;
}

/** Shared conversation surface for proactive openings and ongoing replies. */
export function TaskScreen({ title, conversationId, kind, state, statusLabel, persistentActivity, activityIcon = "thinking", ask, items, typing = false, quiet = false, onOpenBrowser, inlinePanels = [], result, centeredStatus, unreadCount = 0, onBack, onReact, onReplyTo, onBlockAction, onRetrySend, children, footer }: {
  title: string; conversationId: string; kind: IconKind; state: IconState; statusLabel: string; persistentActivity?: string; activityIcon?: ActivityIconName;
  ask?: AskPhase;
  items: ThreadItem[];
  typing?: boolean;
  quiet?: boolean;
  live?: { label: string; frameUrl?: string | null; onOpenBrowser?: () => void } | null;
  inlinePanels?: InlinePanel[];
  result?: AgentResult | null;
  centeredStatus?: { title: string; subtitle?: string };
  unreadCount?: number;
  onReplyTo?: (item: Extract<ThreadItem, { kind: "user" | "agent" }>) => void;
  onBlockAction?: (action: AgentFollowUpAction) => void | boolean | Promise<boolean | void>;
  onRetrySend?: (messageId: string) => void | Promise<void>;
  onReact?: (messageId: string, emoji: string | null) => Promise<void>;
  onBack: () => void;
  onOpenBrowser?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const identity = useContext(ConversationDetailsContext);
  const [detailsOrigin, setDetailsOrigin] = useState<DetailsOrigin | null>(null);
  const detailsOpen = detailsOrigin !== null;
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const openedAt = useRef(Date.now());
  useEffect(() => { receiveMessageFeedback(items, openedAt.current, quiet); }, [items, quiet]);
  const header = useRef<HTMLElement>(null);
  const openDetails = () => {
    const pill = header.current?.querySelector('.wd-taskbar-title > strong');
    if (!pill) return;
    const rect = pill.getBoundingClientRect();
    (document.activeElement as HTMLElement)?.blur();
    setDetailsOrigin({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  };
  const pageRef = useRef<HTMLDivElement>(null);
  const page = pageRef.current;
  const sending = items.some(item => item.kind === "user" && item.deliveryState === "sending")
    || Boolean(page && (hasPendingMessageSend(page) || page.closest<HTMLElement>(".wd")?.dataset.sendingMessage));
  const activity = persistentActivity ?? (sending ? "Thinking" : state === "live" ? statusLabel || "Thinking" : null);
  const displayedActivityIcon = persistentActivity ? activityIcon : sending ? "thinking" : activityIcon;
  const browserAvailable = Boolean(onOpenBrowser);
  const [browserMounted, setBrowserMounted] = useState({ conversationId, visible: browserAvailable });
  const showBrowser = browserMounted.conversationId === conversationId && browserMounted.visible;
  const browserExiting = showBrowser && !browserAvailable;
  useEffect(() => {
    if (browserAvailable) {
      setBrowserMounted({ conversationId, visible: true });
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBrowserMounted({ conversationId, visible: false });
      return;
    }
    const timer = window.setTimeout(() => setBrowserMounted({ conversationId, visible: false }), 150);
    return () => window.clearTimeout(timer);
  }, [conversationId, browserAvailable]);
  const nativeHeader = useNativeChatHeader(header, title, unreadCount, onBack, onOpenBrowser, activity, ACTIVITY_ICONS[displayedActivityIcon].symbol, browserExiting, openDetails);
  const end = useRef<HTMLDivElement>(null);
  const [, refreshAfterSend] = useState(0);
  useLayoutEffect(() => {
    const root = pageRef.current?.closest<HTMLElement>(".wd");
    if (!root) return;
    const observer = new MutationObserver(() => { refreshAfterSend(value => value + 1); });
    observer.observe(root, { attributes: true, attributeFilter: ["data-sending-message"] });
    return () => observer.disconnect();
  }, []);
  const positioned = useRef(false);
  const previousItemCount = useRef(items.length);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const bubbleMotion = useRef<ReturnType<typeof attachBubbleMotion> | null>(null);
  useLayoutEffect(() => {
    if (!pageRef.current) return;
    const detachViewport = attachConversationViewport(pageRef.current);
    const detachGradient = attachMessageGradient(pageRef.current);
    const page = pageRef.current;
    const clearNewMessages = () => { if (conversationIsPinned(page)) setHasNewMessages(false); };
    page.addEventListener('scroll', clearNewMessages, { passive: true });
    const detachInputFocus = attachConversationInputFocus(pageRef.current);
    const motion = attachBubbleMotion(pageRef.current);
    bubbleMotion.current = motion;
    return () => { page.removeEventListener("scroll", clearNewMessages); detachInputFocus(); detachGradient(); detachViewport(); motion.dispose(); bubbleMotion.current = null; };
  }, []);
  const visibleItems = useMemo(() => combineMessageResults(items).filter(item => ['user', 'agent', 'call', 'wait', 'answers', 'blocks'].includes(item.kind) && !(item.kind === 'answers' && item.compact && item.answers.some(answer => answer.question === 'Requested action'))), [items]);
  const replyIds = visibleItems.filter(item => item.kind === 'agent').map(item => item.id);
  const [typingDisplay, setTypingDisplay] = useState(() => ({ conversationId, active: typing, ids: replyIds, consumed: false }));
  const freshReply = replyIds.some(id => !typingDisplay.ids.includes(id));
  const consumedTyping = typing && typingDisplay.conversationId === conversationId && (typingDisplay.consumed || freshReply);
  if (typingDisplay.conversationId !== conversationId || typingDisplay.active !== typing || freshReply || typingDisplay.ids.length !== replyIds.length) {
    setTypingDisplay({ conversationId, active: typing, ids: replyIds, consumed: consumedTyping });
  }
  const showTyping = typing && !consumedTyping;
  const typingSize = useRef({ width: 59, height: 37 });
  const seenMessages = useRef<{ conversationId: string; ids: Set<string> } | null>(null);
  useLayoutEffect(() => {
    const typingBubble = pageRef.current?.querySelector<HTMLElement>('.wd-typing');
    if (typingBubble) typingSize.current = { width: typingBubble.offsetWidth, height: typingBubble.offsetHeight };
    const ids = new Set(visibleItems.filter(item => item.kind === "user" || item.kind === "agent").map(item => item.id));
    const previous = seenMessages.current;
    seenMessages.current = { conversationId, ids };
    if (!previous || previous.conversationId !== conversationId || previous.ids.size === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const item of visibleItems) {
      if (item.kind !== "agent" || previous.ids.has(item.id) || !item.createdAt || Date.parse(item.createdAt) < openedAt.current) continue;
      const bubble = Array.from(pageRef.current?.querySelectorAll<HTMLElement>(".wd-thread > .wd-reactable[data-message-id]") ?? [])
        .find(element => element.dataset.messageId === item.id);
      const surface = bubble?.querySelector<HTMLElement>(':scope > .wd-agent');
      if (surface) animateIncomingMessage(surface, typingSize.current);
    }
  }, [conversationId, visibleItems, typing]);
  const [inlineState, setInlineState] = useState<{ conversationId: string; records: InlineRecord[] }>(() => ({ conversationId, records: savedInlineHistory(conversationId) }));
  const priorRecords = inlineState.conversationId === conversationId ? inlineState.records : savedInlineHistory(conversationId);
  const panels: InlinePanel[] = [...inlinePanels, ...Children.toArray(children).map((node, index) => ({ id: `inline:${isValidElement(node) ? node.key ?? index : index}`, node, summary: "" }))];
  // A newly arriving error/approval waits for the outgoing bubble to land.
  const presentedPanels = pageRef.current?.closest<HTMLElement>(".wd")?.dataset.sendingMessage
    ? panels.filter(panel => priorRecords.some(record => record.id === panel.id)) : panels;
  const records = reconcileInlineRecords(priorRecords, presentedPanels, visibleItems, new Date().toISOString());
  if (inlineState.conversationId !== conversationId || JSON.stringify(records) !== JSON.stringify(priorRecords)) setInlineState({ conversationId, records });
  useEffect(() => {
    if (!records.length) return;
    inlineHistory.set(conversationId, records);
    try { sessionStorage.setItem(`Dash:inline:${conversationId}`, JSON.stringify(records)); } catch { /* Private mode or full storage: retain navigation history in memory. */ }
  }, [conversationId, JSON.stringify(records)]);
  const livePanels = new Map(presentedPanels.map(panel => [panel.id, panel]));
  const isChoicePanel = (id: string) => {
    const node = livePanels.get(id)?.node;
    const record = records.find(record=>record.id===id);
    const replacement = visibleItems.find(item=>item.id===record?.replaces);
    return livePanels.get(id)?.message || record?.message || isValidElement(node) && node.type === QuestionsCard || replacement?.kind === "answers" && replacement.answers.every(answer=>answer.choice);
  };
  const groupedItems = inlineTimeline(visibleItems, records).map(row => "item" in row ? row.item : isChoicePanel(row.panel.id) ? {id:row.panel.id,kind:"agent" as const,text:"",createdAt:row.panel.createdAt} : undefined);
  const groups = new Map(groupedItems.flatMap((item, index) => item ? [[item.id, `${sameMessageGroup(groupedItems[index - 1], item) ? ' is-grouped' : ''}${sameMessageGroup(item, groupedItems[index + 1]) ? ' has-following' : ''}`]] : []));
  const groupClasses = (item: typeof visibleItems[number]) => groups.get(item.id) ?? '';
  // Choice prompts join agent message groups; receipts retain their own layout.
  // Their data can arrive after the reply while rendering at an earlier anchor.
  const latestMessage = visibleItems.findLast(item => item.kind === "user" || item.kind === "agent");
  const latestOutgoing = visibleItems.findLast(item => item.kind === "user");
  // Messages keeps the previous receipt visible until the new send has a
  // status. Removing it at takeoff makes the old bubble jump upward.
  const sendingPreviousReceiptId = latestMessage?.kind === "user" && latestMessage.deliveryState === "sending"
    ? visibleItems.slice(0, visibleItems.indexOf(latestMessage)).findLast(item => item.kind === "user")?.id
    : null;
  const [receiptHandoff, setReceiptHandoff] = useState<string | null>(null);
  const sendingReceipt = useRef<{ newId: string; previousId: string } | null>(null);
  useLayoutEffect(() => {
    if (sendingPreviousReceiptId && latestMessage?.kind === "user") {
      sendingReceipt.current = { newId: latestMessage.id, previousId: sendingPreviousReceiptId };
      setReceiptHandoff(null);
      return;
    }
    const prior = sendingReceipt.current;
    if (!prior || prior.newId !== latestMessage?.id) return;
    sendingReceipt.current = null;
    setReceiptHandoff(prior.previousId);
    // Keep the destination fixed until the native/web flight has landed.
    // The old receipt's slot then closes with the CSS spacing transition.
    let timer: number;
    const release = () => {
      if (pageRef.current?.closest<HTMLElement>(".wd")?.dataset.sendingMessage) {
        timer = window.setTimeout(release, 16);
      } else setReceiptHandoff(null);
    };
    timer = window.setTimeout(release, 180);
    return () => window.clearTimeout(timer);
  }, [sendingPreviousReceiptId, latestMessage?.id]);
  const previousReceiptId = sendingPreviousReceiptId ?? receiptHandoff;
  const resultKey = result ? JSON.stringify(result) : null;
  const panelIds = JSON.stringify(presentedPanels.map(panel => panel.id));
  const previousPanelIds = useRef(new Set<string>());
  const positionedRows = useRef(new Set<Element>());
  const arrivalScroll = useRef<Animation[]>([]);
  useEffect(() => {
    const cancel = () => { arrivalScroll.current.forEach(animation => animation.cancel()); arrivalScroll.current = []; };
    const page = pageRef.current;
    page?.addEventListener('pointerdown', cancel, { passive: true });
    page?.addEventListener('wheel', cancel, { passive: true });
    return () => { cancel(); page?.removeEventListener('pointerdown', cancel); page?.removeEventListener('wheel', cancel); };
  }, []);
  // Scroll only this page. scrollIntoView can move transformed ancestors during a push.
  useLayoutEffect(() => {
    const page = end.current?.closest<HTMLElement>(".wd-task");
    if (page) {
      if (!positioned.current || hasPendingMessageSend(page) || conversationIsPinned(page)) {
        const outgoing = hasPendingMessageSend(page) || Boolean(page.closest<HTMLElement>('.wd')?.dataset.sendingMessage);
        const previousScroll = page.scrollTop;
        arrivalScroll.current.forEach(animation => animation.cancel());
        arrivalScroll.current = [];
        bubbleMotion.current?.reset(); page.scrollTop = page.scrollHeight;
        const shift = page.scrollTop - previousScroll;
        if (positioned.current && !outgoing && shift && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          // Commit the actual scroll immediately, then carry existing pixels
          // from their old position. New replies have their own arrival motion.
          for (const row of positionedRows.current) {
            if (row.isConnected) arrivalScroll.current.push(row.animate([
              { transform: `translateY(${shift}px)` },
              { transform: 'translateY(0)' },
            ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }));
          }
        }
        paintMessageGradient(page); animateMessageSend(page); setHasNewMessages(false);
      } else if (items.length > previousItemCount.current || presentedPanels.some(panel => !previousPanelIds.current.has(panel.id))) setHasNewMessages(true);
      previousPanelIds.current = new Set(presentedPanels.map(panel => panel.id));
      positioned.current = true; previousItemCount.current = items.length;
      positionedRows.current = new Set(page.querySelectorAll('.wd-thread > *'));
    }
  // React elements are recreated by polling and composer edits. Their identity
  // must not reset the reader's scroll position when the content is unchanged.
  }, [items.length, resultKey, typing, records.length, panelIds]);
  return (
    <div ref={pageRef} inert={detailsOpen} className={`wd-screen wd-task${ask ? " is-ask" : ""}${centeredStatus ? " is-status" : ""}`}>
      {detailsOpen && pageRef.current && createPortal(<ConversationDetails origin={detailsOrigin!} title={title} conversationId={conversationId} items={items} loadingLabel={centeredStatus?.title} onClose={() => setDetailsOrigin(null)} />, pageRef.current.closest(".wd") ?? document.body)}
      <header ref={header} className={`wd-taskbar${nativeHeader ? " has-native-header" : ""}`}>
        <button type="button" className={`wd-round wd-chat-back${unreadCount > 0 ? " has-unread" : ""}`} aria-label={unreadCount > 0 ? `Back, ${unreadCount} unread messages` : "Back"} onClick={onBack}><BackIcon />{unreadCount > 0 && <span className="wd-back-count" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>
        <button type="button" className="wd-taskbar-title" aria-label={`Chat details for ${title}`} onClick={openDetails}>
          <TaskIcon avatar={identity?.setting?.avatar} conversationId={conversationId} kind={kind} state={state === "live" || state === "need" ? state : "watch"} size={68} animated />
          <strong title={title} className={activity ? "has-activity" : undefined}><span className="wd-chat-name">{title}<span className="wd-chat-details-chevron" aria-hidden="true">›</span></span><span className="wd-chat-activity-slot" aria-hidden={!activity}><ToolActivityIndicator label={activity ?? ""} icon={displayedActivityIcon} announce={Boolean(activity)} /></span></strong>
        </button>
        {showBrowser ? <button type="button" className={`wd-round wd-browser-reveal${browserExiting ? " is-exiting" : ""}`} aria-label="Open browser" aria-hidden={browserExiting} disabled={browserExiting} onClick={onOpenBrowser}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4M8 21h8"/></svg></button> : null}
      </header>

      {centeredStatus ? <div className="wd-centered-status"><h1>{centeredStatus.title}</h1>{centeredStatus.subtitle && <p>{centeredStatus.subtitle}</p>}</div> : ask ? (
        <div className="wd-ask">
          {ask.createdAt && <time className="wd-message-time" dateTime={ask.createdAt}>{messageTimeLabel(ask.createdAt)}</time>}
          <div className="wd-ask-group">
          <MessageReaction className="has-following" text={ask.sub || ask.headline} onReact={onReact ? emoji => onReact("opening", emoji) : undefined} onReply={onReplyTo ? () => onReplyTo({ id: "opening", kind: "agent", text: ask.sub || ask.headline }) : undefined}>
          <div className={`wd-agent wd-ask-message${ask.why.length ? " has-why" : ""}`}>
            <MessageMarkdown text={ask.sub || ask.headline} />
          {ask.why.length > 0 && <MessageWhy key={conversationId} reasons={ask.why} />}
          </div>
          </MessageReaction>
          <div className="wd-ask-panel"><ProactiveChoices ask={ask} /></div>
          </div>
        </div>
      ) : (
        <div className="wd-thread">
          {inlineTimeline(groupMessageTimes(visibleItems), records).map((row) => {
            if ("panel" in row) {
              const panel = row.panel;
              const live = livePanels.get(panel.id);
              const replacement = panel.replaces ? visibleItems.find(item => item.id === panel.replaces) : undefined;
              if (!live && !replacement && !panel.summary) return null;
              return <TimelinePanel key={panel.id} id={panel.id} className={isChoicePanel(panel.id) ? (groups.get(panel.id) ?? "").trim() || undefined : undefined} active={Boolean(live)}>{live?.node ?? (replacement?.kind === "answers" ? <AnswersSummary {...replacement} /> : replacement?.kind === "call" ? <CompletedCall call={replacement} /> : replacement?.kind === "wait" ? <WaitReceipt wait={replacement} /> : panel.id.startsWith("pause:") && panel.summary === "Waiting ended" ? <WaitReceipt wait={{ reason: "" }} /> : panel.summary ? <p className="wd-inline-history">{panel.summary}</p> : null)}</TimelinePanel>;
            }
            const item = row.item;
            if (item.kind === "timestamp") return <time key={item.id} className="wd-message-time" dateTime={item.createdAt}>{messageTimeLabel(item.createdAt)}</time>;
            if (item.kind === "user") return <div key={item.id} data-message-id={item.id} className={`wd-user-turn${groupClasses(item)}${item.deliveryState === "failed" ? " is-failed" : ""}`}><MessageReaction mine text={item.text} onReact={onReact && !item.deliveryState ? emoji => onReact(item.id, emoji) : undefined} onReply={onReplyTo ? () => onReplyTo(item) : undefined} reactions={item.reactions}>{item.replyTo && <QuotedReply role={item.replyTo.role} text={item.replyTo.text} />}<UserAttachmentsMessage item={item} /></MessageReaction>{(item.deliveryState === "failed" || item.id === latestOutgoing?.id || item.id === previousReceiptId) && <MessageReceipt item={item} isPrevious={item.id === previousReceiptId} />}{item.deliveryState === "failed" && onRetrySend && <><button type="button" className="wd-message-retry" aria-label="Failed message options" aria-expanded={retryMessage === item.id} onClick={() => setRetryMessage(current => current === item.id ? null : item.id)}><span aria-hidden="true">!</span></button>{retryMessage === item.id && <div className="wd-message-retry-actions"><button type="button" onClick={() => { setRetryMessage(null); void onRetrySend(item.id); }}>Try Again</button><button type="button" onClick={() => setRetryMessage(null)}>Cancel</button></div>}</>}</div>;
            if (item.kind === "agent" && item.files?.length) return <MessageReaction key={item.id} messageId={item.id} className={groupClasses(item)} text={item.text} onReply={onReplyTo ? () => onReplyTo(item) : undefined} reactions={item.reactions} onReact={onReact ? emoji => onReact(item.id, emoji) : undefined}><FileMessage files={item.files} caption={item.fileCaption} /></MessageReaction>;
            if (item.kind === "agent" && item.videos?.length) return <MessageReaction key={item.id} messageId={item.id} className={groupClasses(item)} text={item.text} onReply={onReplyTo ? () => onReplyTo(item) : undefined} reactions={item.reactions} onReact={onReact ? emoji => onReact(item.id, emoji) : undefined}><VideoMessage videos={item.videos} caption={item.videoCaption} /></MessageReaction>;
            if (item.kind === "agent" && item.photos?.length) return <MessageReaction key={item.id} messageId={item.id} className={groupClasses(item)} text={item.text} onReply={onReplyTo ? () => onReplyTo(item) : undefined} reactions={item.reactions} onReact={onReact ? emoji => onReact(item.id, emoji) : undefined}><PhotoMessage photos={item.photos} caption={item.photoCaption} /></MessageReaction>;
            if (item.kind === "agent") return <MessageReaction key={item.id} messageId={item.id} className={groupClasses(item)} text={item.text} onReply={onReplyTo ? () => onReplyTo(item) : undefined} reactions={item.reactions} onReact={onReact ? emoji => onReact(item.id, emoji) : undefined}><div className="wd-agent"><MessageMarkdown text={item.text} results={item.results} /></div></MessageReaction>;
            if (item.kind === "blocks") return item.blocks?.length ? <div key={item.id} className={`wd-block-message${groupClasses(item)}`}><ResultBlocks resultId={item.id} blocks={item.blocks} followUpActions={item.followUpActions} onAction={onBlockAction} /></div> : null;
            if (item.kind === "wait") return <WaitReceipt key={item.id} wait={item} />;
            if (item.kind === "call") return <CompletedCall key={item.id} call={item} />;
            if (item.kind === "answers") return <AnswersSummary key={item.id} {...item} />;
            return null; // Tool execution stays outside the consumer transcript.
          })}
          {showTyping && <div className="wd-typing" role="status" aria-label="Dash is typing"><i /><i /><i /></div>}
          <div ref={end} />
        </div>
      )}
      {footer}
      {/* Disabled: inline updates can falsely trigger this indicator. Keep for later.
      {hasNewMessages && <button className="wd-latest-message" onClick={() => {
        pageRef.current?.scrollTo({ top: pageRef.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        setHasNewMessages(false);
      }}><span aria-hidden="true">↓</span> New messages</button>}
      */}
    </div>
  );
}

function UserAttachmentsMessage({ item }: { item: Extract<ThreadItem, { kind: "user" }> }) {
  const local = useMemo(() => (item.localFiles ?? []).map((file, index) => ({ id: `local-${index}`, url: attachmentPreview(file), name: file.name, mimeType: file.type, description: fileDescription(file.name, file.type, file.size) })), [item.localFiles]);
  const photos = item.photos?.length ? item.photos : local.filter(file => file.mimeType.startsWith("image/"));
  const files = item.files?.length ? item.files : local.filter(file => !file.mimeType.startsWith("image/"));
  const text = photos.length || files.length ? item.text.replace(/(?:^|\n\n)Attached: [^\n]+$/, "").replace(/^(Shared an attachment|Photo)$/, "").trim() : item.text;
  return <>{photos.length > 0 && <PhotoMessage photos={photos} mine />}{files.length > 0 && <FileMessage files={files} mine />}{text && <UserMessage text={text} />}</>;
}

function UserMessage({ text }: { text: string }) {
  const message = splitLocationMessage(text);
  if (!message.location) return <TextBubble text={text} />;
  const location = message.location;
  return <div className="wd-user-turn">
    {message.text && <TextBubble text={message.text} />}
    <a className="wd-location-card" href={sharedLocationUrl(location)} target="_blank" rel="noreferrer" aria-label="View shared location in Maps">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
      <span><strong>Shared location</strong><small>{sharedLocationAccuracy(location)}</small><time dateTime={location.capturedAt}>{new Date(location.capturedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><span>View in Maps ↗</span></span>
    </a>
  </div>;
}

function TextBubble({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    fitMessageBubble(node);
    const page = node.closest<HTMLElement>('.wd-task');
    if (!page) return;
    let width = page.clientWidth;
    const observer = new ResizeObserver(() => {
      if (page.clientWidth !== width) { width = page.clientWidth; fitMessageBubble(node); }
    });
    observer.observe(page);
    return () => observer.disconnect();
  }, [text]);
  return <div ref={ref} className="wd-bubble is-me">{text}</div>;
}
