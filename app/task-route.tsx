"use client";
import { starterForDecision } from "../lib/first-use";

import { useEasterEggEvent } from "./easter-eggs";
import { ConversationDetailsContext } from "./conversation-details-context";
import { ConnectorCard } from "./connector-card";
import { includeWaitSummaries } from "../lib/harness/wait-summary";
import { historyThreadItems } from "./history-thread";
import { NativeGlassButton } from "./native-glass-button";
import { userFiles } from "../lib/harness/user-files";
import { userPhotos } from "../lib/harness/user-photos";
import type { InlinePanel } from "./inline-timeline";
import { watchConversation } from "./conversation-updates";
import { includeCallSummaries } from "../lib/harness/call-summary";
import { uiPreviewThreads } from "./preview-fixtures";
import { pendingInteractionSummary } from "./pending-interaction";
import { AnswersSummary, WaitStatus } from "./conversation-status";
import { includeAnsweredQuestions } from "../lib/harness/question-summary";
import { unmatchedPendingMessages } from "./pending-messages";
import { postNativeMessage } from "./native-bridge";
import { conversationWorkLabel, conversationWorkActivity } from "../lib/harness/thread";
import { ThreadCache } from "./thread-cache";
import { attachmentReplyText } from "./chat-files";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from "react";
import { conversationKey, type ConversationSettings } from "../lib/conversation-settings";
import type { AgentRunSnapshot } from "../lib/harness/types";
import type { ThreadItem } from "../lib/harness/thread";
import type { Decision, DecisionOption, HistoryEntry, RunningTask } from "../lib/types";
import { AppleActionCard, ExternalApprovalCard, QuestionsCard, ReconnectCard, SensitiveActionCard, SignInCard, TakeoverCard, VaultCard } from "./approvals";
import { discardThreadOptions, retainSubmittedReply } from "../lib/harness/thread";
import { conversationCalendar } from "./calendar-context";
import { Composer } from "./composer";
import { BackIcon } from "./home";
import { iconKindFor, type IconState } from "./task-icon";
import { TaskScreen, type AskPhase } from "./task-screen";
import { historyFromRun, restorableDecisionFromHistory, taskFromRun } from "./workspace-model";
import { resolveTaskRoute, type TaskRouteBinding } from "./task-route-context";

export type TaskActions = {
  onConversationAction?: (action: import("../lib/conversation-settings").ConversationAction) => Promise<boolean>;
  onEntryReaction?: (entry: HistoryEntry, messageId: string, emoji: string | null) => Promise<void>;
  onReactionPreview?: (key: string, emoji: string | null) => () => void;
  quiet?: boolean;
  unreadCount?: number;
  onRead?: (key: string, through: string) => void;
  onBack: () => void;
  onChoose: (decision: Decision, option: DecisionOption) => Promise<boolean>;
  onCustom: (decision: Decision, text: string, files?: File[], reaction?: string) => Promise<boolean>;
  onDismiss: (decision: Decision) => void;
  onCalendar: (decision: Decision, date?: string) => void;
  onApprove: (task: RunningTask, mode?: "once" | "always", emailEdit?: { subject: string; body: string }, retryNative?: boolean) => Promise<boolean>;
  onSkip: (task: RunningTask) => Promise<void>;
  onReplaceTask: (snapshot: AgentRunSnapshot) => void;
  onContinue: (entry: HistoryEntry, text: string, files?: File[]) => Promise<void>;
  onReply: (runId: string, text: string, files?: File[], replyTo?: string) => Promise<void>;
  onCancel: (task: RunningTask) => void;
  onStop: (runId: string, title: string) => void;
  onOpenBrowser: (runId: string, control: boolean, frameId?: string) => void;
  onRetry: (decision: Decision, entryId?: string, runId?: string) => Promise<boolean>;
  onSnapshot: (snapshot: AgentRunSnapshot) => void;
  onThreadItems?: (key: string, items: ThreadItem[]) => void;
};

/**
 * Resolves whatever id Home, the drawer or a notification handed us (decision,
 * task, history entry or raw run id) into one of two views: the centered
 * question for an unanswered decision, or the thread for everything else.
 */
export type PendingConversation = { files: File[]; id: string; text: string; createdAt: string; error?: string; retrying: boolean; onRetry: () => Promise<void> };

export function TaskRoute({ id, decisions, tasks, history, snapshots, previewMode, actions, messageCache, conversationSettings = {}, pendingStart }: {
  pendingStart?: PendingConversation; messageCache?: Map<string, ThreadItem[]>; conversationSettings?: ConversationSettings; id: string; decisions: Decision[]; tasks: RunningTask[]; history: HistoryEntry[]; snapshots: Map<string, AgentRunSnapshot>; previewMode: boolean; actions: TaskActions;
}) {
  const [binding, setBinding] = useState<TaskRouteBinding | null>(null);
  const { decision, task, entry, runId, resolvedRunId, snapshot } = resolveTaskRoute({ id, decisions, tasks, history, snapshots, binding });
  // Capture a known mapping before paint, not in an effect that can run after
  // reply acceptance removes the history row. Never carry it to another route.
  if (resolvedRunId && (binding?.routeId !== id || binding.runId !== resolvedRunId)) setBinding({ routeId: id, runId: resolvedRunId });
  const receiveSnapshot = useRef(actions.onSnapshot);
  receiveSnapshot.current = actions.onSnapshot;
  const settingsKey = conversationKey(decision?.id ?? task?.decisionId ?? entry?.decisionId ?? snapshot?.decisionId ?? undefined, runId, entry?.id ?? id);
  const setting = conversationSettings[settingsKey];
  const wrap = (child: React.ReactNode) => <ConversationDetailsContext.Provider value={{ setting, save: action => actions.onConversationAction?.({ ...action, key: settingsKey }) ?? Promise.resolve(false) }}>{child}</ConversationDetailsContext.Provider>;
  const customTitle = setting?.title;
  actions = { ...actions, quiet: setting?.archived === true };

  useEffect(() => {
    if (!runId || previewMode || pendingStart) return;
    return watchConversation(runId, snapshot => receiveSnapshot.current(snapshot));
  }, [runId, previewMode, Boolean(pendingStart)]);

  if (decision && !runId && !pendingStart) return wrap(<AskRoute key={decision.id} customTitle={customTitle} decision={decision} actions={actions} />);
  if (runId) return wrap(<ThreadRoute pendingStart={pendingStart} messageCache={messageCache} key={id} customTitle={customTitle} runId={runId} task={task} entry={entry} decision={decision} snapshot={snapshot} previewMode={previewMode} actions={actions} />);
  if (entry) return wrap(<EntryRoute key={entry.id} customTitle={customTitle} entry={entry} actions={actions} />);
  return (
    <div className="wd-screen wd-task">
      <header className="wd-taskbar"><NativeGlassButton symbol="chevron.left" type="button" className="wd-round" aria-label="Back" onClick={actions.onBack}><BackIcon /></NativeGlassButton><span className="wd-round is-ghost" /></header>
      <div className="wd-empty"><p>This task isn’t here any more.</p></div>
    </div>
  );
}

function AskRoute({ decision, actions, customTitle }: { customTitle?: string; decision: Decision; actions: TaskActions }) {
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ text: string; files?: File[]; createdAt: string; reaction?: string; optionId?:string } | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendar = conversationCalendar({ decision });
  const ask: AskPhase = {
    headline: decision.title,
    createdAt: decision.createdAt,
    sub: decision.subtitle,
    why: decision.whyThisAppeared ?? [],
    options: decision.options,
    dismissLabel: decision.dismissLabel || "Not now",
    busyOptionId,
    selectedOptionId:submitted?.optionId,
    onChoose: async (option) => {
      if (submitted) return;
      setSubmitted({ text: option.label, optionId:option.id, createdAt: new Date().toISOString() });
      setBusyOptionId(option.id); setError(null);
      try { if (!await actions.onChoose(decision, option)) { setSubmitted(null); setError("The agent could not start. Try again."); } }
      catch (caught) { setSubmitted(null); setError(caught instanceof Error ? caught.message : "Your reply could not be sent."); }
      finally { setBusyOptionId(null); }
    },
    onDismiss: () => actions.onDismiss(decision),
    onCalendar: calendar ? () => actions.onCalendar(calendar.decision, calendar.date) : undefined,
  };
  return (
    <TaskScreen
      quiet={actions.quiet}
      conversationId={conversationKey(decision.id, decision.activeRunId)}
      title={customTitle || decision.title}
      kind={iconKindFor(decision.category)}
      state={submitted ? "watch" : "need"}
      statusLabel={submitted ? "Sending" : "Needs you"}
      ask={starterForDecision(decision) || submitted && !submitted.optionId ? undefined : ask}
      onReact={async (_messageId, emoji) => {
        if (!emoji || submitted) return;
        setSubmitted({ text: "", reaction: emoji, createdAt: new Date().toISOString() });
        try {
          if (!await actions.onCustom(decision, `Reacted ${emoji} to your message: ${JSON.stringify(decision.subtitle || decision.title)}`, [], emoji)) throw new Error("Reaction couldn’t send. Try again.");
        } catch (caught) { setSubmitted(null); setError(caught instanceof Error ? caught.message : "Reaction couldn’t send. Try again."); throw caught; }
      }}
      onReplyTo={() => setText("")}
      items={submitted && !submitted.optionId ? [
        { id: `${decision.id}:opening`, kind: "agent", text: decision.subtitle || decision.title, createdAt: decision.createdAt, ...(submitted.reaction ? { reactions: [{ actor: "user", emoji: submitted.reaction, createdAt: submitted.createdAt }] } : {}) },
        ...(!submitted.reaction ? [{ id: `${decision.id}:submitted`, kind: "user" as const, text: submitted.text, localFiles: submitted.files, createdAt: submitted.createdAt, deliveryState: "sending" as const }] : []),
      ] : starterForDecision(decision) ? [{ id: `${decision.id}:opening`, kind: "agent", text: decision.subtitle, createdAt: decision.createdAt }] : []}
      unreadCount={actions.unreadCount}
      onBack={actions.onBack}
      footer={<Composer onFiles={incoming => setFiles(current => [...current, ...incoming])} files={files} onRemoveFile={index => setFiles(current => current.filter((_, i) => i !== index))} fileCount={files.length} fileBytes={files.reduce((total, file) => total + file.size, 0)} variant="thread" placeholder="Reply…" value={text} onChange={setText} sending={sending} error={error} disabled={Boolean(submitted)} onSend={async (message) => {
        const instruction = attachmentReplyText(message, files);
        if (!instruction) return false;
        if (submitted) return false;
        setSubmitted({ text: instruction, files, createdAt: new Date().toISOString() });
        setFiles([]);
        setSending(true); setError(null);
        try { if (await actions.onCustom(decision, instruction, files)) return true; setFiles(current => current.length ? current : files); setSubmitted(null); setError("The agent could not start. Try again."); return false; }
        catch (caught) { setFiles(current => current.length ? current : files); setSubmitted(null); setError(caught instanceof Error ? caught.message : "Your reply could not be sent."); return false; }
        finally { setSending(false); }
      }} />}
    />
  );
}

function statusOf(snapshot: AgentRunSnapshot | undefined, task: RunningTask | undefined, entry: HistoryEntry | undefined, previewMode: boolean) {
  if (snapshot) return snapshot.status;
  // Saved workspace rows can predate a follow-up or use legacy failure rules.
  // Keep live work feedback, but never infer a terminal state before loading the run.
  if (task && (previewMode || task.status !== "failed")) return task.status === "waiting" ? "paused" : task.status === "needs_approval" ? "awaiting_approval" : task.status === "failed" ? "failed" : "running";
  if (previewMode) return entry?.status === "failed" ? "failed" : "done";
  return undefined;
}

function ThreadRoute({ messageCache, customTitle, runId, task, entry, decision, snapshot, previewMode, actions, pendingStart }: {
  pendingStart?: PendingConversation; messageCache?: Map<string, ThreadItem[]>; customTitle?: string; runId: string; task?: RunningTask; entry?: HistoryEntry; decision?: Decision; snapshot?: AgentRunSnapshot; previewMode: boolean; actions: TaskActions;
}) {
  const cachedItems = useSyncExternalStore(
    useCallback(listener => messageCache instanceof ThreadCache ? messageCache.subscribe(runId, listener) : () => {}, [messageCache, runId]),
    useCallback(() => messageCache?.get(runId), [messageCache, runId]),
    () => undefined,
  );
  const [items, setItems] = useState<ThreadItem[]>(() => {
    const cached = messageCache?.get(runId);
    if (cached?.length) return cached;
    // Only real transcript items belong in the chat. History outcomes can be
    // synthetic receipts (including legacy "Done."), not assistant messages.
    return [];
  });
  useEffect(() => {
    postNativeMessage({ version: 1, action: "visibleConversation", payload: { runId } });
    return () => postNativeMessage({ version: 1, action: "visibleConversation", payload: { runId: null } });
  }, [runId]);
  useEasterEggEvent(snapshot?.metadata.easterEggEvent ?? snapshot?.metadata.confettiEvent);
  const receiveThread = useRef(actions.onThreadItems); receiveThread.current = actions.onThreadItems;
  const [loadedRunId, setLoadedRunId] = useState(runId);
  const initialSendTime = useRef(pendingStart?.createdAt);
  const [threadReady, setThreadReady] = useState(() => Boolean(messageCache?.has(runId) || previewMode));
  const [sendMotionPreview, setSendMotionPreview] = useState(false);
  const [previewTyping, setPreviewTyping] = useState(false);
  const previewTimers = useRef<number[]>([]);
  useEffect(() => () => { previewTimers.current.forEach(window.clearTimeout); }, []);
  useEffect(() => {
    setSendMotionPreview(process.env.NODE_ENV === "development" && previewMode && new URLSearchParams(window.location.search).has("sendMotionPreview"));
  }, [previewMode]);
  const [threadLoadError, setThreadLoadError] = useState(false);
  const [threadRetry, setThreadRetry] = useState(0);
  const sendInFlight = useRef(false);
  const [pendingMessages, setPendingMessages] = useState<Array<{ id: string; kind: "user"; localFiles?: File[]; text: string; createdAt: string; deliveredAt?: string; deliveryState?: "sending" | "failed"; replyTo?: import("../lib/harness/reactions").ReplyContext; existingIds: string[]; supersededActionId?: string }>>([]);
  const [replyTo, setReplyTo] = useState<import("../lib/harness/reactions").ReplyContext | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const latestDraft = useRef({ text, files, replyTo });
  latestDraft.current = { text, files, replyTo };
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [reconnect, setReconnect] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const status = statusOf(snapshot, task, entry, previewMode);
  const automaticPause = status === "paused" ? (snapshot?.metadata.automaticPause as import("../lib/pauses/definition").PauseDisplay | undefined) ?? task?.automaticPause : undefined;
  const callActivity = automaticPause?.eventKind === "phone_call" ? automaticPause.phoneCall?.status === "in_progress" ? "On the call" : "Calling" : undefined;
  const busy = status === "running" || status === "planning";
  const replying = pendingMessages.some(message => message.deliveryState !== "failed");
  const localItems = cachedItems ?? (loadedRunId !== runId ? [] : items);
  // The first server snapshot can contain only the opening message. Preserve
  // the submitted reply during the AskRoute -> ThreadRoute handoff before paint.
  const deliveredItems = includeWaitSummaries(includeCallSummaries(includeAnsweredQuestions(snapshot?.threadItems ? retainSubmittedReply(snapshot.threadItems, localItems) : localItems, snapshot?.actions ?? []), snapshot?.actions ?? []), snapshot?.actions ?? [], automaticPause);
  const outstandingMessages = unmatchedPendingMessages(pendingMessages, deliveredItems);
  const visibleItems = replying || busy ? discardThreadOptions(deliveredItems) : deliveredItems;
  const readKey = conversationKey(decision?.id ?? task?.decisionId ?? entry?.decisionId ?? snapshot?.decisionId ?? undefined, runId, entry?.id);
  const readThrough = visibleItems.reduce<string | undefined>((latest, item) => "createdAt" in item && item.createdAt && (!latest || item.createdAt > latest) ? item.createdAt : latest, undefined);
  useLayoutEffect(() => {
    if (!readThrough || pendingStart) return;
    const markRead = () => { if (!document.hidden) actions.onRead?.(readKey, readThrough); };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [readKey, readThrough, actions.onRead, Boolean(pendingStart)]);
  const needsYou = task?.status === "needs_approval";
  const generatedIdentity = snapshot?.metadata.conversationIdentityGenerated === true;
  const title = customTitle || ((generatedIdentity ? snapshot?.title : undefined) ?? task?.title ?? decision?.title ?? entry?.title ?? snapshot?.title ?? "Task");
  const category = (generatedIdentity ? snapshot?.category as Decision["category"] : undefined) ?? task?.category ?? decision?.category ?? entry?.category ?? (snapshot?.category as Decision["category"] | undefined) ?? "social";
  const activeLabel = snapshot ? conversationWorkLabel(snapshot) : task?.activity?.label ?? null;
  const state: IconState = needsYou ? "need" : busy ? "live" : status === "done" ? "done" : "watch";
  const statusLabel = task?.nativeAction && task.status === "waiting" ? "Waiting for iPhone" : automaticPause ? automaticPause.eventKind === "phone_call" ? "Calling" : "Waiting" : needsYou ? "Needs you" : busy ? "Working" : status === "done" ? "Done" : status === "failed" || status === "cancelled" ? "Stopped" : status ? "Watching" : "";
  const frames = useMemo(() => task?.browserFrames ?? (snapshot ? taskFromRun(snapshot).browserFrames ?? [] : []), [task, snapshot]);
  const browserUsed = task?.browserUsed ?? (snapshot ? taskFromRun(snapshot).browserUsed : false);
  const showBrowserControl = browserUsed && status !== "done" && status !== "failed" && status !== "cancelled";
  const selectedPayment = items.findLast(item => item.kind === "answers" && item.vault?.kind === "payment_card");
  const result = status === "done" ? snapshot?.result ?? entry?.result ?? null : null;
  const failure = status === "failed" ? snapshot?.error ?? (previewMode ? entry?.outcome : undefined) ?? "Dash couldn’t finish this task." : null;
  const retryDecision = useMemo(() => status === "failed" || status === "cancelled" ? (entry ? restorableDecisionFromHistory(entry) : snapshot ? restorableDecisionFromHistory(historyFromRun(snapshot)) : null) : null, [status, entry, snapshot]);
  const stamp = snapshot?.updatedAt ?? task?.updatedAt;

  const previewUser = task?.chosenOption ?? entry?.chosenOption ?? "Help with this";
  const previewAgent = task?.subtitle ?? entry?.outcome;

  useEffect(() => {
    if (pendingStart) return;
    if (previewMode) {
      setItems(uiPreviewThreads[runId] ?? messageCache?.get(runId) ?? [{ id: "preview-user", kind: "user", text: previewUser, createdAt: task?.updatedAt ?? entry?.completedAt, deliveredAt: task?.updatedAt, readAt: task?.updatedAt }, ...(!busy && previewAgent ? [{ id: "preview-agent", kind: "agent" as const, text: previewAgent, createdAt: task?.updatedAt ?? entry?.completedAt }] : [])]);
      return;
    }
    let cancelled = false;
    const load = snapshot?.threadItems ? Promise.resolve(snapshot.threadItems) : messageCache instanceof ThreadCache
      ? messageCache.load(runId)
      : fetch(`/api/runs/${encodeURIComponent(runId)}/messages`, { cache: "no-store" }).then(async response => {
        if (!response.ok) throw new Error("Messages could not be loaded.");
        return (await response.json() as { items: ThreadItem[] }).items;
      });
    void load.then(fetched => {
      if (cancelled) return;
      const received = retainSubmittedReply(fetched, messageCache?.get(runId) ?? []);
      messageCache?.set(runId, received);
      setItems(received); setLoadedRunId(runId); setThreadReady(true); setThreadLoadError(false);
      receiveThread.current?.(conversationKey(decision?.id ?? task?.decisionId ?? entry?.decisionId ?? snapshot?.decisionId ?? undefined, runId, entry?.id), received);
      setPendingMessages(pending => unmatchedPendingMessages(pending, received));
    }).catch(() => { if (!cancelled) setThreadLoadError(true); });
    return () => { cancelled = true; };
  }, [runId, stamp, status, previewMode, previewUser, previewAgent, busy, threadRetry, Boolean(pendingStart)]);

  const skip = async () => {
    if (!task || skipping) return;
    const dismissalPrompt = task.approvalKind === "purchase" ? "Decline this purchase?\n\nDash will not place this order. Keep going to review it instead."
      : task.approvalKind === "signin" ? "Skip signing in?\n\nDash will try to continue without this sign-in. Keep going to sign in instead."
        : task.approvalKind === "connector" || task.approvalKind === "reconnect" ? "Skip connecting?\n\nDash will try to continue without this connection. Keep going to connect instead."
          : task.approvalKind === "vault_login" ? "Skip this login?\n\nDash will try to continue without your saved login. Keep going to unlock it instead." : null;
    if (dismissalPrompt && !window.confirm(dismissalPrompt)) return;
    if (task.approvalKind === "questions" && !window.confirm("Dismiss these questions?\n\nDash will continue without these answers. Keep going to answer them instead.")) return;
    if (task.approvalKind === "vault_payment" && !window.confirm("Stop choosing a card?\n\nKeep going to finish choosing and unlocking your card, or choose Not now to skip this request.")) return;
    setSkipping(true); setError(null);
    try { await actions.onSkip(task); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The agent could not try another route."); }
    finally { setSkipping(false); }
  };

  const approval = task && (needsYou || task.nativeAction) && task.actionId ? (
    task.nativeAction ? <AppleActionCard task={task} onApprove={retry => actions.onApprove(task, "once", undefined, retry)} onCancel={() => actions.onCancel(task)} />
      : task.approvalKind === "connector" ? <ConnectorCard task={task} skipping={skipping} onConnected={() => actions.onApprove(task)} onSkip={() => void skip()} />
      : task.approvalKind === "signin" ? <SignInCard task={task} skipping={skipping} onResumed={actions.onReplaceTask} onSkip={() => void skip()} onOpenBrowser={() => actions.onOpenBrowser(runId, true)} />
      : task.approvalKind === "takeover" ? <TakeoverCard task={task} onContinue={() => actions.onApprove(task)} skipping={skipping} onOpenBrowser={() => actions.onOpenBrowser(runId, true)} onSkip={() => void skip()} />
        : task.approvalKind === "vault_login" || task.approvalKind === "vault_payment" ? <VaultCard task={task} skipping={skipping} onSaved={actions.onReplaceTask} onSkip={() => void skip()} />
          : task.approvalKind === "questions" ? <QuestionsCard task={task} skipping={skipping} onAnswered={actions.onReplaceTask} onSkip={() => void skip()} />
            : task.approvalKind === "email_send" || task.approvalKind === "purchase" ? <SensitiveActionCard task={{ ...task, browserFrames: frames }} payment={selectedPayment?.kind === "answers" ? selectedPayment.vault : undefined} onOpenBrowser={task.browserUsed || frames.length ? () => actions.onOpenBrowser(runId, false) : undefined} denying={skipping} onApprove={(mode, emailEdit) => actions.onApprove(task, mode, emailEdit)} onDeny={() => void skip()} />
              : task.approvalKind === "reconnect" ? <ReconnectCard busy={reconnect.busy} error={reconnect.error} onSkip={() => void skip()} onReconnect={async () => {
                setReconnect({ busy: true });
                try { if (!await actions.onApprove(task)) setReconnect({ busy: false, error: "Google reconnected, but this task could not resume. Try again." }); else setReconnect({ busy: false }); }
                catch (caught) { setReconnect({ busy: false, error: caught instanceof Error ? caught.message : "Google reconnect did not finish." }); }
              }} />
                : <ExternalApprovalCard task={task} busy={skipping} onApprove={async () => { setError(null); if (!await actions.onApprove(task)) setError("That approval is no longer pending."); }} onCancel={() => actions.onCancel(task)} />
  ) : null;

  const sendMessage = async (message: string, selectedFiles = files, target = replyTo, clearComposer = true, retryId?: string) => {
    if (sendInFlight.current) return false;
    const reply = attachmentReplyText(message, selectedFiles);
    if (!reply) return false;
    if (clearComposer) { setFiles([]); setReplyTo(null); }
    if (sendMotionPreview) {
      const id = crypto.randomUUID();
      setPendingMessages(pending => [...pending, { id, kind: "user", text: reply, localFiles: selectedFiles, createdAt: new Date().toISOString(), deliveryState: "sending", existingIds: items.map(item => item.id) }]);
      window.setTimeout(() => setPendingMessages(pending => pending.map(item => item.id === id ? { ...item, deliveryState: undefined, deliveredAt: new Date().toISOString() } : item)), 650);
      if (new URLSearchParams(window.location.search).get('sendMotionPreview') === 'reply') {
        previewTimers.current.push(window.setTimeout(() => setPreviewTyping(true), 1200));
        previewTimers.current.push(window.setTimeout(() => {
          const now = new Date().toISOString();
          setPendingMessages(pending => pending.filter(item => item.id !== id));
          setItems(current => [...current,
            { id, kind: 'user', text: reply, createdAt: now, deliveredAt: now, readAt: now },
            { id: `${id}:reply`, kind: 'agent', text: 'Heyyy yourself. I’m right here, what do you need?', createdAt: now },
          ]);
          setPreviewTyping(false);
        }, 2100));
      }
      return true;
    }
    sendInFlight.current = true;
    setSending(true); setError(null);
    const pendingId = retryId ?? crypto.randomUUID();
    setPendingMessages(pending => retryId ? pending.map(item => item.id === retryId ? { ...item, deliveryState: "sending", supersededActionId: task?.actionId } : item) : [...pending, { supersededActionId: task?.actionId, id: pendingId, kind: "user", localFiles: selectedFiles, text: reply, createdAt: new Date().toISOString(), deliveryState: "sending", ...(target ? { replyTo: target } : {}), existingIds: items.map(item => item.id) }]);
    try {
      await actions.onReply(runId, reply, selectedFiles, target?.messageId);
      setItems(current => discardThreadOptions(current));
      const cached = messageCache?.get(runId);
      if (cached) messageCache?.set(runId, discardThreadOptions(cached));
      setPendingMessages(pending => pending.map(item => item.id === pendingId ? { ...item, deliveryState: undefined } : item));

      if (retryId && latestDraft.current.text === message && latestDraft.current.files === selectedFiles && latestDraft.current.replyTo === target) { setText(""); setFiles([]); setReplyTo(null); }
      return true;
    }
    catch {
      if (clearComposer) { setFiles(current => current.length ? current : selectedFiles); setReplyTo(current => current ?? target); }
      setPendingMessages(pending => pending.map(item => item.id === pendingId ? { ...item, deliveryState: "failed" } : item)); return false;
    }
    finally { sendInFlight.current = false; setSending(false); }
  };

  const inlineError = useRef({ value: null as string | null, id: "" });
  if (inlineError.current.value !== error) inlineError.current = { value: error, id: `${runId}:error:${Date.now()}` };
  const inlinePanels: InlinePanel[] = [];
  const pendingInteraction = task?.actionId && pendingMessages.some(message => message.deliveryState !== "failed" && message.supersededActionId === task.actionId)
    ? pendingInteractionSummary(task, snapshot?.actions.find(action => action.id === task.actionId)) : null;
  if (approval && !busy && task?.actionId) inlinePanels.push({
    id: `approval:${task.actionId}`,
    message:task.approvalKind === "questions",
    node: pendingInteraction ? <AnswersSummary {...pendingInteraction} /> : <div className={task.nativeAction ? "wd-apple-action-panel" : undefined} inert={replying || undefined}>{approval}</div>,
    summary: "",
    replaces: `answers:${task.actionId}`,
  });
  if (automaticPause && !(automaticPause.phoneCall && deliveredItems.some(item => item.id === `call:${automaticPause.phoneCall!.actionId}`))) inlinePanels.push({
    id: `pause:${automaticPause.id}`, node: <WaitStatus pause={automaticPause} />,
    summary: automaticPause.phoneCall ? "Call ended" : "Waiting ended",
    replaces: automaticPause.phoneCall ? `call:${automaticPause.phoneCall.actionId}` : `wait:${automaticPause.id}`,
    createdAt: deliveredItems.find((item): item is Extract<ThreadItem, { kind: "wait" }> => item.kind === "wait" && item.id === `wait:${automaticPause.id}`)?.createdAt,
  });
  if (failure || status === "cancelled") {
    const retryButton = retryDecision ? <button type="button" className={failure ? "wd-btn is-secondary wd-inline-btn" : "wd-task-stopped-restart"} aria-label={failure ? undefined : "Restart task"} title={failure ? undefined : "Restart task"} aria-busy={retrying || undefined} disabled={retrying} onClick={async () => {
      setRetrying(true); setRetryError(null);
      try { if (!await actions.onRetry(retryDecision, entry?.id, runId)) setRetryError("The agent could not start. Try again."); }
      catch (caught) { setRetryError(caught instanceof Error ? caught.message : "The agent could not start. Try again."); }
      finally { setRetrying(false); }
    }}>{retrying ? <span className="wd-spinner" aria-hidden="true" /> : !failure ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" /></svg> : null}{failure && <span>Try again</span>}</button> : null;
    inlinePanels.push({
      id: `${runId}:stopped:${snapshot?.completedAt ?? entry?.completedAt ?? status}`,
      createdAt: snapshot?.completedAt ?? entry?.completedAt ?? undefined,
      summary: failure ? "Attempt couldn’t finish." : "Task stopped",
      node: <div className="wd-inline-stack" inert={replying || undefined}>
        {failure ? <><div className="wd-agent">{failure}</div>{retryButton}</> : <div className="wd-task-stopped"><span>Task stopped</span>{retryButton}</div>}
        {retryError && <p className="wd-card-error" role="alert">{retryError}</p>}
      </div>,
    });
  }
  if (error && !needsYou) inlinePanels.push({ id: inlineError.current.id, node: <p className="wd-card-error" role="alert">{error}</p>, summary: "Action couldn’t finish." });

  return (
    <TaskScreen
      quiet={actions.quiet}
      conversationId={pendingStart ? conversationKey(pendingStart.id) : readKey}
      title={pendingStart ? "New chat" : title}
      kind={pendingStart ? "doc" : iconKindFor(category)}
      state={pendingStart ? pendingStart.error ? "watch" : "live" : replying ? "live" : state}
      persistentActivity={callActivity}
      activityIcon={callActivity ? "phone" : pendingStart || replying ? "thinking" : snapshot ? conversationWorkActivity(snapshot)?.icon ?? "thinking" : task?.activity?.icon ?? "thinking"}
      statusLabel={callActivity ?? (pendingStart ? pendingStart.error ? "Failed" : "Thinking" : replying ? "Thinking" : busy ? activeLabel ?? (snapshot?.metadata.replyTyping === true ? "Typing" : "Thinking") : statusLabel)}
      items={pendingStart ? [{id: pendingStart.id, kind: "user", localFiles: pendingStart.files, text: pendingStart.text, createdAt: pendingStart.createdAt, deliveryState: pendingStart.error ? "failed" : "sending"}] : outstandingMessages.length ? [...visibleItems, ...outstandingMessages] : visibleItems.length ? visibleItems : !snapshot?.metadata.initialReaction && (snapshot?.request || task?.chosenOption) ? [{ id: `${runId}:pending`, kind: "user", createdAt: snapshot?.createdAt ?? initialSendTime.current ?? task?.updatedAt, files: snapshot ? userFiles(snapshot) : [], photos: snapshot ? userPhotos(snapshot) : [], text: (snapshot?.metadata.userMessage as string | undefined) ?? task?.chosenOption ?? snapshot!.request }] : visibleItems}
      typing={previewTyping || (!replying && busy && Boolean(snapshot && conversationWorkActivity(snapshot)?.icon === "typing"))}
      onOpenBrowser={showBrowserControl ? () => actions.onOpenBrowser(runId, false) : undefined}
      inlinePanels={inlinePanels}
      result={result}
      centeredStatus={!approval && !pendingStart && !threadReady && !cachedItems && !snapshot?.threadItems && deliveredItems.length === 0 ? { title: threadLoadError ? "Messages couldn’t load" : "Loading messages…" } : undefined}
      unreadCount={actions.unreadCount}
      onBack={actions.onBack}
      onRetrySend={async messageId => {
        if (pendingStart?.id === messageId) { if (!pendingStart.retrying) await pendingStart.onRetry(); return; }
        const failed = outstandingMessages.find(item => item.id === messageId && item.deliveryState === "failed");
        if (failed) await sendMessage(failed.text, failed.localFiles ?? [], failed.replyTo ?? null, false, failed.id);
      }}
      onReplyTo={item => { setReplyTo({ messageId: item.id, text: item.text, role: item.kind }); }}
      onBlockAction={action => sendMessage(action.intent, [], null, false)}
      onReact={async (messageId, emoji) => {
        if (previewMode) {
          setItems(current => current.map(item => item.id === messageId && (item.kind === "agent" || item.kind === "user") ? { ...item, reactions: emoji ? [{ actor: "user", emoji, createdAt: new Date().toISOString() }] : [] } : item));
          return;
        }
        const rollbackPreview = actions.onReactionPreview?.(readKey, emoji);
        try {
          const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reaction: { eventId: crypto.randomUUID(), messageId, emoji } }) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Reaction couldn’t send. Try again.");
          setItems(current => current.map(item => item.id === messageId && (item.kind === "agent" || item.kind === "user") ? { ...item, reactions: [...(item.reactions ?? []).filter(reaction => reaction.actor !== "user"), ...(emoji ? [{ actor: "user" as const, emoji, createdAt: new Date().toISOString() }] : [])] } : item));
          if (["done", "failed", "cancelled"].includes(body.status)) actions.onSnapshot(body as AgentRunSnapshot);
          else actions.onReplaceTask(body as AgentRunSnapshot);
          setThreadRetry(value => value + 1);
        } catch (error) { rollbackPreview?.(); throw error; }
      }}
      footer={<>{!threadReady && threadLoadError && <button className="wd-btn is-secondary" onClick={() => { setThreadLoadError(false); setThreadRetry(value => value + 1); }}>Retry messages</button>}<Composer replyTo={replyTo ? { name: replyTo.role === "agent" ? "Dash" : "yourself", text: replyTo.text } : undefined} onCancelReply={() => setReplyTo(null)} onFiles={incoming => setFiles(current => [...current, ...incoming])} files={files} onRemoveFile={index => setFiles(current => current.filter((_, i) => i !== index))} fileCount={files.length} fileBytes={files.reduce((total, file) => total + file.size, 0)} variant="thread" placeholder="Reply…" value={text} onChange={setText} sending={sending || Boolean(pendingStart) || !threadReady} disabled={previewMode && !sendMotionPreview} error={error || pendingStart?.error} onStop={busy && !pendingStart ? () => actions.onStop(runId, title) : undefined} onSend={message => sendMessage(message)} /></>}
    />
  );
}

/** A decision that never ran an agent: dismissed, or answered with a no-action option. */
function EntryRoute({ entry, actions, customTitle }: { customTitle?: string; entry: HistoryEntry; actions: TaskActions }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <TaskScreen
      quiet={actions.quiet}
      conversationId={conversationKey(entry.decisionId, entry.runId, entry.id)}
      title={customTitle || entry.title}
      kind={iconKindFor(entry.category)}
      state="watch"
      statusLabel="Dash"
      items={historyThreadItems(entry)}
      onReact={actions.onEntryReaction ? (messageId, emoji) => actions.onEntryReaction!(entry, messageId, emoji) : undefined}
      result={entry.result ?? null}
      unreadCount={actions.unreadCount}
      onBack={actions.onBack}
      footer={<Composer onFiles={incoming => setFiles(current => [...current, ...incoming])} files={files} onRemoveFile={index => setFiles(current => current.filter((_, i) => i !== index))} fileCount={files.length} fileBytes={files.reduce((total, file) => total + file.size, 0)} variant="thread" placeholder="Reply…" value={text} onChange={setText} sending={sending} error={error} onSend={async (message) => {
        const reply = attachmentReplyText(message, files);
        if (!reply) return false;
        setSending(true); setError(null);
        setFiles([]);
        try { await actions.onContinue(entry, reply, files); return true; }
        catch (caught) { setFiles(current => current.length ? current : files); setError(caught instanceof Error ? caught.message : "Your reply could not be sent."); return false; }
        finally { setSending(false); }
      }} />}
    />
  );
}
