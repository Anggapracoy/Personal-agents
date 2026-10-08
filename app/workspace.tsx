"use client";
import { starterDecision, starterForDecision, starterRequest, firstUseFallbackEligible } from "../lib/first-use";

import { animateArchiveChoice } from "./archive-choice-motion";
import { useProfilePhoto } from "./use-profile-photo";
import { historyThreadItems } from "./history-thread";
import { SettingsSheet } from "./settings-sheet";
import { AppleActionRunner } from "./apple-action-runner";
import { appleActionKey, createAppleActionExecutor } from "./apple-action-executor";
import { currentAppleConnections } from "./apple-connection-context";
import { requestNativeApple } from "./native-bridge";
import { userPhotos } from "../lib/harness/user-photos";
import { userFiles } from "../lib/harness/user-files";
import { useLifeProfileCache } from "./life-profile-cache";
import { ThreadCache } from "./thread-cache";
import { encodeChatFiles } from "./chat-files";
import { appendSharedDraft } from "./shared-draft";
import { createNavigationMotion } from "./navigation-motion";
import { createScreenNavigation } from "./screen-navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import type { Decision, DecisionOption, HistoryEntry, RunningTask } from "../lib/types";
import { retainSubmittedReply, threadItems } from "../lib/harness/thread";
import type { AgentRunSnapshot } from "../lib/harness/types";
import { BrowserSheet } from "./browser-sheet";
import { shouldCloseBrowserForAttention, type BrowserSheetAttention } from "./browser-sheet-attention";
import type { ConversationCalendar } from "./calendar-context";
import { CalendarSheet } from "./calendar-sheet";
import { splitLocationMessage } from "../lib/shared-location";
import { Composer } from "./composer";
import { ConfirmSheet, type ConfirmAction } from "./confirm-sheet";
import { withConversationIdentity } from "../lib/conversation-identity";
import { useConversationSettings } from "./conversation-settings";
import { conversationKey } from "../lib/conversation-settings";
import { newManualConversationId } from "../lib/conversation-character";
import { conversationItems } from "./conversations";
import { savingsThisYear } from "./money-saved";
import { Home } from "./home";
import { readConversationList, saveConversationList, clearConversationList, type ConversationListSnapshot } from "./conversation-list-cache";
import { browserTimeZone, hasNativeBridge, isNativeShell, postNativeMessage, requestNativeGoogleReconnect, requestNativeVault, responseError, unregisterNativePushToken, type NativeWindow, type VaultItemSummary } from "./native-bridge";
import { uiPreviewDecisions, uiPreviewVaultItems } from "./preview-fixtures";
import { TaskRoute, type TaskActions } from "./task-route";
import { useWorkspaceStore } from "./workspace-store";
import {
  completedHistoryFromDecision, completedHistoryFromTask, createHarnessRun, decisionResultFailed, failedHistoryFromDecision, failedHistoryFromTask, historyFromDecision, historyFromRun,
  mergeScannedDecisions, optionNeedsNoAgent, shouldArchiveNoActionChoice, readGoogleScan, scanContext, taskFromRun,
  type DeviceCalendarSnapshot, type ManualScanJob, type SharedIntakeDetail,
} from "./workspace-model";
import { type YouPanel } from "./you";

type Screen = { kind: "home" } | { kind: "archive" } | { kind: "task"; id: string } | { kind: "you"; panel?: YouPanel };
type Confirm =
  | { kind: "dismiss"; decisionId: string }
  | { kind: "cancel-task"; taskId: string }
  | { kind: "stop-run"; runId: string; title: string }
  | { kind: "sign-out" }
  | { kind: "delete"; action: "data" | "account" }
  | { kind: "stop-scan" }
  | { kind: "vault-delete"; item: VaultItemSummary };
type BrowserSheetState = { runId: string; control: boolean; frameId?: string; attention: BrowserSheetAttention };
type Props = { user: { name: string; email: string; image?: string | null; profilePhoto?: string | null }; googleConnected: boolean; googleConnections?: import("./workspace-model").GoogleConnection[]; proactiveV2?: boolean; previewMode?: boolean; previewScanState?: "idle" | "scanning" | "confirm" | "first" | "empty" | "arriving" };

const HOME: Screen = { kind: "home" };
const INITIAL_SCAN = (action: "claim" | "complete" | "retry") => fetch("/api/mobile/onboarding/initial-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);

function parentOf(screen: Screen): Screen {
  return screen.kind === "you" && screen.panel ? { kind: "you", panel: screen.panel === "connectors" ? "sources" : screen.panel.startsWith("memory-") ? "memory" : undefined } : HOME;
}

function screenFromUrl(params: URLSearchParams): Screen | null {
  const task = params.get("task") ?? params.get("decision") ?? params.get("entry");
  if (task) return { kind: "task", id: task };
  if (params.get("view") === "settings" || params.get("connections") === "1") return { kind: "you", panel: params.get("connections") === "1" ? "sources" : undefined };
  return null;
}

export default function Workspace({ user: suppliedUser, googleConnected, googleConnections, proactiveV2 = false, previewMode = false, previewScanState = "idle" }: Props) {
  const profilePhoto = useProfilePhoto(suppliedUser.email, suppliedUser.profilePhoto ?? null, previewMode);
  const user = { ...suppliedUser, image: profilePhoto.image ?? suppliedUser.image };
  const store = useWorkspaceStore(previewMode, user.email);
  const conversationSettings = useConversationSettings(user.email, previewMode);
  const { decisions, tasks, history, discardedDecisionIds, appearance, modelSettings, ready, setDecisions, setTasks, setHistory, setDiscardedDecisionIds } = store;
  const listCacheCleared = useRef(false);
  const [nativeShell, setNativeShell] = useState(false);
  useLayoutEffect(() => setNativeShell(isNativeShell()), []);
  const [screen, setScreen] = useState<Screen>(HOME);
  const [browserSheet, setBrowserSheet] = useState<BrowserSheetState | null>(null);
  const [calendarContext, setCalendarContext] = useState<ConversationCalendar | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(previewMode && previewScanState === "confirm" ? { kind: "stop-scan" } : null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [snapshots, setSnapshots] = useState<Map<string, AgentRunSnapshot>>(() => new Map());
  const lifeProfile = useLifeProfileCache(user.email, previewMode);
  const cachedThreads = useMemo(() => new ThreadCache(`${previewMode ? "preview:" : ""}${user.email}`), [user.email, previewMode]);
  const messageCache = useRef(cachedThreads); messageCache.current = cachedThreads;
  const snapshotsRef = useRef(snapshots); snapshotsRef.current = snapshots;
  const [now, setNow] = useState<number | null>(null);
  const [deviceCalendar, setDeviceCalendar] = useState<DeviceCalendarSnapshot>({ status: "notDetermined", events: [] });
  const [vaultItems, setVaultItems] = useState<VaultItemSummary[]>(previewMode ? uiPreviewVaultItems : []);
  const [vaultLoading, setVaultLoading] = useState(!previewMode);
  const [previewFoundCount, setPreviewFoundCount] = useState(0);
  useEffect(() => {
    if (!previewMode || previewScanState !== "arriving") return;
    setTasks([]);
    setHistory([]);
    setDecisions(uiPreviewDecisions.map((decision, index) => ({ ...decision, actionableUntil: undefined, createdAt: new Date(Date.now() - index * 1_000).toISOString() })));
    const timers = [1, 2, 3].map(count => window.setTimeout(() => setPreviewFoundCount(count), count * 3_000));
    timers.push(window.setTimeout(() => { setScanJobId(null); setScanStatus(null); }, 12_000));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [previewMode, previewScanState]);
  useEffect(() => {
    if (previewMode && ["first", "empty"].includes(previewScanState)) { setDecisions([]); setTasks([]); setHistory([]); }
  }, [previewMode, previewScanState]);
  const [initialScanFinished, setInitialScanFinished] = useState(previewMode && previewScanState === "empty");
  const [mailSourcesLoaded, setMailSourcesLoaded] = useState(previewMode);
  const [firstUse, setFirstUse] = useState<boolean | null>(previewMode && ["first", "empty"].includes(previewScanState) ? true : null);
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/mobile/onboarding/first-use', { cache: 'no-store' });
        if (response.ok) { const data = await response.json(); if (!cancelled) { setFirstUse(!data.hasUsefulResult); setInitialScanFinished(data.initialScanFinished === true); } }
      } catch { /* Keep the last known state during an interrupted connection. */ }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, [previewMode, screen.kind]);
  const [emptyFirstScan, setEmptyFirstScan] = useState<string | null>(previewMode && previewScanState === "empty" ? "preview-empty" : null);
  const [scanJobId, setScanJobId] = useState<string | null>(previewMode && !["idle", "empty"].includes(previewScanState) ? "preview-scan" : null);
  const [scanStatus, setScanStatus] = useState<string | null>(previewMode && !["idle", "empty"].includes(previewScanState) ? "Scanning safely in the background" : null);
  const [initialScanSignal, setInitialScanSignal] = useState(0);
  const [iCloudConnected, setICloudConnected] = useState(false);
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    const refresh = async () => {
      const response = await fetch("/api/connections/icloud", { cache: "no-store" }).catch(() => null);
      if (!response?.ok || cancelled) return;
      const data = await response.json() as { accounts: Array<{ enabled: boolean; needsReconnect: boolean }> };
      if (!cancelled) setMailSourcesLoaded(true);
      if (!cancelled) setICloudConnected(data.accounts.some(account => account.enabled && !account.needsReconnect));
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("decisionFeed:initialSignupScan", refresh);
    window.addEventListener("decisionFeed:mailConnectionChanged", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); window.removeEventListener("decisionFeed:initialSignupScan", refresh); window.removeEventListener("decisionFeed:mailConnectionChanged", refresh); };
  }, [previewMode]);
  const [homeText, setHomeText] = useState("");
  const [homeFocusRequest, setHomeFocusRequest] = useState(0);
  const [homeFiles, setHomeFiles] = useState<File[]>([]);
  const [pendingStart, setPendingStart] = useState<{ id: string; text: string; request: string; createdAt: string; files: File[]; error?: string } | null>(null);
  const [homeSending, setHomeSending] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const homeDraftRef = useRef({ text: homeText, files: homeFiles, sending: homeSending });
  homeDraftRef.current = { text: homeText, files: homeFiles, sending: homeSending };
  const decisionsRef = useRef(decisions); decisionsRef.current = decisions;
  const tasksRef = useRef(tasks); tasksRef.current = tasks;
  const screenRef = useRef(screen); screenRef.current = screen;
  const initialScanActiveRef = useRef(false);
  const appleExecutor = useRef(createAppleActionExecutor<boolean>());
  useEffect(() => { appleExecutor.current.retain(new Set(tasks.filter(task => task.nativeAction).map(appleActionKey))); }, [tasks]);
  const remoteRunIds = useMemo(() => tasks.flatMap((task) => task.runId && (task.status !== "waiting" || task.nativeAction) ? [task.runId] : []).sort().join(","), [tasks]);

  const rootRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<ReturnType<typeof createNavigationMotion> | null>(null);
  if (!motionRef.current) motionRef.current = createNavigationMotion(() => rootRef.current, payload => {
    postNativeMessage({ version: 1, action: "navigationFrame", payload });
  });
  const pendingMotion = useRef<{ direction: "push" | "pop"; side: 1 | -1; from: number } | null>(null);
  useLayoutEffect(() => {
    if (pendingMotion.current) {
      motionRef.current!.navigate(pendingMotion.current.direction, pendingMotion.current.from, pendingMotion.current.side);
      pendingMotion.current = null;
    }
  }, [screen]);
  useEffect(() => () => motionRef.current?.dispose(), []);

  /* ---------- navigation ---------- */
  const navigationRef = useRef<ReturnType<typeof createScreenNavigation<Screen>> | null>(null);
  if (!navigationRef.current) navigationRef.current = createScreenNavigation<Screen>({
    initial: HOME,
    parent: parentOf,
    show: (next, direction) => {
      const settingsTransition = next.kind === "you" || screenRef.current.kind === "you";
      postNativeMessage({ version: 1, action: "navigationMotion", payload: { direction, fromLeft: false, backFromRight: false, backEnabled: next.kind !== "home" && next.kind !== "you" } });
      pendingMotion.current = settingsTransition ? null : { direction, side: 1, from: motionRef.current!.capture(JSON.stringify(next), JSON.stringify(screenRef.current)) };
      screenRef.current = next;
      setScreen(next);
    },
    // Preserve Next's router state so browser back does not reload the document.
    pushHistory: () => window.history.pushState(window.history.state, ""),
    backHistory: () => window.history.back(),
  });

  const open = (next: Screen) => navigationRef.current!.open(next);
  const back = () => navigationRef.current!.back();
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const openTask = (id: string) => { if (!store.hasRemoteState) setPendingOpen(id); else open({ kind: "task", id }); };
  useEffect(() => { if (store.hasRemoteState && pendingOpen) { open({ kind: "task", id: pendingOpen }); setPendingOpen(null); } }, [store.hasRemoteState, pendingOpen]);
  const rememberSnapshot = (snapshot: AgentRunSnapshot) => {
    const previous = snapshotsRef.current.get(snapshot.id);
    if ((previous?.updatedAt ?? "") > snapshot.updatedAt) return previous!;
    if (snapshot.threadItems) cachedThreads.set(snapshot.id, retainSubmittedReply(snapshot.threadItems, cachedThreads.get(snapshot.id) ?? []));
    if (previous?.metadata.conversationIdentityGenerated === true && snapshot.metadata.conversationIdentityGenerated !== true) {
      snapshot = { ...snapshot, title: previous.title, category: previous.category,
        metadata: { ...snapshot.metadata, conversationIdentityGenerated: true } };
    }
    setSnapshots((current) => {
      if ((current.get(snapshot.id)?.updatedAt ?? "") > snapshot.updatedAt) return current;
      const next = new Map(current); next.set(snapshot.id, snapshot); return next;
    });
    if (snapshot.metadata.conversationIdentityGenerated === true) {
      setDecisions(items => items.map(item => item.activeRunId === snapshot.id || item.id === snapshot.decisionId ? withConversationIdentity(item, snapshot) : item));
      setTasks(items => items.map(item => item.runId === snapshot.id ? withConversationIdentity(item, snapshot) : item));
      setHistory(items => items.map(item => item.runId === snapshot.id ? withConversationIdentity(item, snapshot) : item));
    }
    return snapshot;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = screenFromUrl(params);
    for (const key of ["task", "decision", "entry", "view", "connections"]) params.delete(key);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    if (target) open(target);
    const onPop = () => navigationRef.current!.popped();
    window.addEventListener("popstate", onPop);
    // Relative stamps are client-only so server and client markup match.
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { window.removeEventListener("popstate", onPop); window.clearInterval(clock); };
  }, []);

  // Disable the removed Home shortcut in already-installed native shells too.
  useEffect(() => {
    postNativeMessage({ version: 1, action: "settingsSwipeEnabled", payload: { enabled: false } });
  }, []);

  /* Edge back-swipe. Native sends began/changed/ended/cancelled with progress; the
     screen follows the finger via --swipe-x, then either pops or springs back. */
  useEffect(() => {
    const setSwipe = (progress: number | null) => {
      if (progress === null) motionRef.current!.cancel();
      else motionRef.current!.drag(progress);
    };
    const swipeable = () => !browserSheet && !calendarContext && !confirm && screenRef.current.kind !== "home" && screenRef.current.kind !== "you";
    const commitBack = () => {
      if (browserSheet) { setBrowserSheet(null); return; }
      if (calendarContext) { setCalendarContext(null); return; }
      if (confirm) { setConfirm(null); return; }
      if (screenRef.current.kind !== "home" && screenRef.current.kind !== "you") back();
    };
    const onBackSwipe = (event: Event) => {
      const detail = (event as CustomEvent<{ phase?: string; progress?: number; commit?: boolean }>).detail ?? {};
      const phase = detail.phase ?? "ended";
      if (phase === "began" || phase === "changed") { if (swipeable()) setSwipe(Math.min(1, Math.max(0, detail.progress ?? 0))); return; }
      if (phase === "cancelled" || (phase === "ended" && !detail.commit)) { setSwipe(null); return; }
      commitBack();
    };
    window.addEventListener("decisionFeed:nativeBackSwipe", onBackSwipe);
    // Web fallback (no native recognizer): a left-edge drag drives the same events.
    let start: { x: number; y: number; side: number; dragging: boolean } | null = null;
    const emit = (phase: string, progress: number, commit: boolean) => window.dispatchEvent(new CustomEvent("decisionFeed:nativeBackSwipe", { detail: { phase, progress, commit } }));
    const onTouchStart = (event: TouchEvent) => {
      if (isNativeShell() || !swipeable() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const side = screenRef.current.kind === "you" ? -1 : 1;
      start = touch && (side === -1 ? touch.clientX > window.innerWidth - 24 : touch.clientX < 24) ? { x: touch.clientX, y: touch.clientY, side, dragging: false } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = start.side * (touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (!start.dragging) {
        if (Math.max(Math.abs(dx), dy) < 8) return;
        if (dx <= dy * 1.3) { start = null; return; }
        start.dragging = true;
        emit("began", 0, false);
      }
      if (event.cancelable) event.preventDefault();
      emit("changed", dx / window.innerWidth, false);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!start?.dragging) { start = null; return; }
      const touch = event.changedTouches[0];
      const progress = touch ? start.side * (touch.clientX - start.x) / window.innerWidth : 0;
      start = null;
      emit("ended", progress, progress >= 0.32);
    };
    const onTouchCancel = () => { start = null; emit("cancelled", 0, false); };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("decisionFeed:nativeBackSwipe", onBackSwipe);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [browserSheet, calendarContext, confirm]);

  useEffect(() => { if (store.migratedFailureId) openTask(store.migratedFailureId); }, [store.migratedFailureId]);

  /* ---------- native bridge ---------- */
  const overlayVisible = Boolean(browserSheet || calendarContext || confirm || screen.kind === "you");
  useLayoutEffect(() => {
    postNativeMessage({ version: 1, action: "modalOverlayVisibility", payload: { visible: overlayVisible, keepsBackgroundChrome: !confirm && !calendarContext && (screen.kind === "you" || Boolean(browserSheet)), hidesNavigation: Boolean(calendarContext || screen.kind === "you") } });
    return () => postNativeMessage({ version: 1, action: "modalOverlayVisibility", payload: { visible: false, hidesNavigation: false } });
  }, [overlayVisible, Boolean(browserSheet), calendarContext, confirm, screen.kind]);
  useLayoutEffect(() => {
    postNativeMessage({ version: 1, action: "browserViewerVisibility", payload: { visible: Boolean(browserSheet) } });
    return () => postNativeMessage({ version: 1, action: "browserViewerVisibility", payload: { visible: false } });
  }, [Boolean(browserSheet)]);
  useEffect(() => {
    if (!ready) return;
    postNativeMessage({ version: 1, action: "workspaceState", payload: {
      needsUserAttention: tasks.some((task) => task.status === "needs_approval"),
      decisions: decisions.filter((decision) => !decision.activeRunId && !decision.result).map((decision) => ({ id: decision.id, title: decision.title, subtitle: decision.subtitle, urgency: decision.urgency, options: decision.options.slice(0, 2).map((option) => ({ id: option.id, label: option.label })) })),
      tasks: tasks.map((task) => ({ id: task.id, decisionId: task.decisionId, runId: task.runId, title: task.title, subtitle: task.subtitle, estimate: task.estimate, status: task.status, approvalKind: task.approvalKind, question: task.questionRequest?.questions[0]?.question })),
    } });
  }, [ready, decisions, tasks]);
  useEffect(() => {
    const receiveCalendar = (event: Event) => setDeviceCalendar((event as CustomEvent<DeviceCalendarSnapshot>).detail);
    const receiveInitialScan = () => setInitialScanSignal((value) => value + 1);
    window.addEventListener("decisionFeed:calendarSnapshot", receiveCalendar);
    window.addEventListener("decisionFeed:initialSignupScan", receiveInitialScan);
    postNativeMessage({ version: 1, action: "requestCalendarStatus" });
    if ((window as NativeWindow).decisionFeedInitialSignupScanRequested) receiveInitialScan();
    return () => { window.removeEventListener("decisionFeed:calendarSnapshot", receiveCalendar); window.removeEventListener("decisionFeed:initialSignupScan", receiveInitialScan); };
  }, []);
  const sharedDeliveries = useRef(new Set<string>());
  useEffect(() => {
    const receiveSharedIntake = (event: Event) => {
      const detail = (event as CustomEvent<SharedIntakeDetail>).detail;
      if (!detail) { event.preventDefault(); return; }
      const deliveryKey = detail.requestId || JSON.stringify(detail);
      if (sharedDeliveries.current.has(deliveryKey)) return;
      setPendingOpen(null);
      setBrowserSheet(null); setCalendarContext(null); setConfirm(null);
      while (screenRef.current.kind !== "home") navigationRef.current!.back();
      try {
        if (homeDraftRef.current.sending) throw new Error("Your message is still sending. Open Dash again when it finishes to add the shared item.");
        const draft = appendSharedDraft(homeDraftRef.current, detail);
        // Update the ref immediately so consecutive deliveries append in order.
        homeDraftRef.current = { ...draft, sending: false };
        setHomeText(draft.text); setHomeFiles(draft.files); setHomeError(null);
        sharedDeliveries.current.add(deliveryKey);
      } catch (error) {
        // Native retains the pending share when the draft cannot accept it.
        event.preventDefault();
        setHomeError(error instanceof Error ? error.message : "That shared item could not be attached.");
      }
    };
    window.addEventListener("decisionFeed:sharedIntake", receiveSharedIntake);
    return () => window.removeEventListener("decisionFeed:sharedIntake", receiveSharedIntake);
  }, []);

  /* ---------- runs ---------- */
  const startRun = async (decision: Decision, option: DecisionOption, detail?: string, instruction?: string, overrides?: Parameters<typeof createHarnessRun>[5]) => {
    const run = await createHarnessRun(decision, option, modelSettings, detail, instruction, overrides);
    const task = taskFromRun(run);
    if (!overrides?.metadata?.initialReaction) {
      conversationSettings.publishOutgoing(conversationKey(decision.id, run.id), String(overrides?.metadata?.userMessage ?? instruction ?? option.label));
    }
    messageCache.current.set(run.id, [
      ...threadItems(run, []),
      ...(!overrides?.metadata?.initialReaction && !threadItems(run, []).some(item=>item.id===`${run.id}:choice`) ? [{ id: `${run.id}:submitted`, kind: "user" as const, photos: userPhotos(run), files: userFiles(run), text: String(overrides?.metadata?.userMessage ?? instruction ?? option.label), createdAt: run.createdAt }] : []),
    ]);
    rememberSnapshot(run);
    const active = { ...decision, activeRunId: run.id, selectedOption: overrides?.metadata?.userMessage ? String(overrides.metadata.userMessage) : option.label };
    setDecisions((items) => { const next = items.some((item) => item.id === decision.id) ? items.map((item) => item.id === decision.id ? active : item) : [active, ...items]; decisionsRef.current = next; return next; });
    setTasks((items) => [task, ...items.filter((item) => item.runId !== run.id)]);
    setHistory((items) => items.filter((entry) => entry.runId !== run.id));
    postNativeMessage({ version: 1, action: "hapticSuccess" });
    if (typeof run.metadata.initialConversationTitle === "string") {
      // Like Kodo, naming runs alongside the agent and never delays opening the chat.
      void fetch(`/api/runs/${encodeURIComponent(run.id)}/suggest-title`, { method: "POST" })
        .then(async response => {
          if (!response.ok) return;
          const data = await response.json() as { snapshot?: AgentRunSnapshot };
          if (data.snapshot) rememberSnapshot(data.snapshot);
        }).catch(() => undefined);
    }
    return task;
  };

  // Every yes and no on a suggestion teaches the proactive engine (v2 accounts only).
  const sendProactiveFeedback = (decision: Decision, kind: "accepted" | "dismissed" | "not_a_loop") => {
    if (!proactiveV2 || previewMode || decision.sourceType === "manual") return Promise.resolve();
    return fetch("/api/proactive/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisionId: decision.id, kind }) })
      .then(() => undefined).catch(() => undefined);
  };
  const resolveDecision = async (decision: Decision, option: DecisionOption) => {
    postNativeMessage({ version: 1, action: "hapticSelection" });
    try {
      if (optionNeedsNoAgent(option)) {
        const archive = shouldArchiveNoActionChoice(decision, option);
        const key = conversationKey(decision.id, decision.activeRunId);
        const row = archive && screenRef.current.kind === "home" ? [...document.querySelectorAll<HTMLElement>('.wd-home [data-conversation-key]')].find(node => node.dataset.conversationKey === key)?.closest<HTMLElement>('.wd-proactive-swipe') : null;
        const rollbackMotion = row ? await animateArchiveChoice(row) : undefined;
        if (archive && !await conversationSettings.apply({ key, action: "archive" })) { rollbackMotion?.(); return false; }
        void sendProactiveFeedback(decision, "dismissed");

        const entry = historyFromDecision(decision, option.label, "dismissed");
        if (archive) {
          setDiscardedDecisionIds(items => items.includes(decision.id) ? items : [...items, decision.id]);
          if (screenRef.current.kind === "task") back();
        }
        setDecisions((items) => items.filter((item) => item.id !== decision.id));
        setHistory((items) => [entry, ...items]);
        return true;
      }
      const detail = option.actionType === "research"
        ? "Research real current options using public sources and the E2B browser when useful. Return the findings directly as structured result options with source URLs. For plural requests, preserve at least three distinct choices. Create files only when the user explicitly requested one. Do not invent availability or prices."
        : option.actionType === "instant" ? "Execute this simple choice immediately if it is risk-free. Any external mutation still requires the runtime's approval gate." : undefined;
      const rerunInstruction = decision.sourceType === "manual" && option.id === "rerun-manual" ? decision.originalContext : undefined;
      await startRun(decision, option, detail, rerunInstruction);
      void sendProactiveFeedback(decision, "accepted");

      return true;
    } catch (error) { console.error(error instanceof Error ? error.message : "The agent could not start"); return false; }
  };
  const resolveCustomInstruction = async (decision: Decision, instruction: string, files: File[] = [], reaction?: string) => {
    if (previewMode && starterForDecision(decision)) {
      const runId = crypto.randomUUID(), createdAt = new Date().toISOString();
      const nextQuestion = starterForDecision(decision)!.key === 'first-task' ? 'What would a good result look like?' : starterForDecision(decision)!.key === 'shopping' ? 'What’s your budget?' : starterForDecision(decision)!.key === 'plan' ? 'When would you like to go?' : 'What would you like to change about it?';
      messageCache.current.set(runId, [
        { id: `${runId}:opening`, kind: 'agent', text: decision.subtitle, createdAt: decision.createdAt },
        { id: `${runId}:answer`, kind: 'user', text: instruction, createdAt, deliveredAt: createdAt },
        { id: `${runId}:next`, kind: 'agent', text: nextQuestion, createdAt },
      ]);
      setDecisions(items => items.map(item => item.id === decision.id ? { ...item, activeRunId: runId } : item));
      setTasks(items => [{ id: `remote-${runId}`, runId, decisionId: decision.id, category: decision.category, title: decision.title, subtitle: nextQuestion, status: 'waiting', chosenOption: instruction, originalContext: decision.originalContext, updatedAt: createdAt } as RunningTask, ...items]);
      return true;
    }
    try { await startRun(decision, { id: "custom", label: instruction, actionType: "approval" }, undefined, instruction, { files, ...(starterForDecision(decision) ? { request: starterRequest(decision, instruction), metadata: { starterKey: starterForDecision(decision)!.key, userMessage: instruction } } : {}), ...(reaction ? { metadata: { initialReaction: reaction } } : {}) }); return true; }
    catch (error) { console.error(error instanceof Error ? error.message : "The agent could not start"); return false; }
  };
  const startConversationTurn = async (text: string, files: File[], retryId?: string) => {
    const fallback = fallbackActive && !retryId ? starterDecision('first-task') : null;
    if (previewMode && fallback) {
      setDecisions(current => [fallback, ...current]); openTask(fallback.id);
      await resolveCustomInstruction(fallback, text, files); return;
    }
    const id = retryId ?? fallback?.id ?? newManualConversationId(conversations[0]?.key);
    const createdAt = new Date().toISOString();
    setPendingStart({ id, text: text || "Shared an attachment", request: text, files, createdAt });
    if (!retryId) openTask(id);
    if (previewMode && new URLSearchParams(window.location.search).has("sendMotionPreview")) {
      // The motion fixture must reach the delivered chat state without sending
      // a preview user's message to the live run API.
      await new Promise(resolve => window.setTimeout(resolve, 900));
      messageCache.current.set(id, [{id, kind: "user", text: text || "Shared an attachment", localFiles: files, createdAt, deliveredAt: new Date().toISOString()}]);
      setTasks(current => [{ id: `remote-${id}`, runId: id, decisionId: id, category: "social", title: "New chat", subtitle: "", status: "running", chosenOption: text, originalContext: text, updatedAt: createdAt }, ...current]);

      setPendingStart(current => current?.id === id ? null : current);
      return;
    }
    try {
      const displayText = splitLocationMessage(text).text || (files.length ? "Photo" : "Shared location");
      const guidance = starterForDecision({ id, sourceType: 'manual' })?.key === 'first-task' ? starterDecision('first-task', id.slice('starter:first-task:'.length), createdAt) : null;
      const decision: Decision = guidance ?? { id, sourceType: "manual", category: "social", urgency: "medium", title: displayText.slice(0, 90), subtitle: displayText, originalContext: text, options: [], dismissLabel: "Not now", createdAt };
      await startRun(decision, { id: "message", label: text, actionType: "approval" }, undefined, undefined, {
        title: decision.title, files,
        request: guidance ? starterRequest(guidance, text || "Read the attached material.") : text || "Read the attached material and help with the request it contains. Ask if the intended task is unclear.",
        metadata: { userMessage: text || "Shared an attachment", sourceType: "manual", generateConversationIdentity: true, ...(guidance ? { starterKey: 'first-task' } : {}) },
      });
      setPendingStart(current => current?.id === id ? null : current);
    } catch (caught) {
      setPendingStart(current => current?.id === id ? { ...current, error: caught instanceof Error ? caught.message : "Your request could not be sent. Try again." } : current);
      throw caught;
    }
  };
  const replaceTask = (snapshot: AgentRunSnapshot) => {
    rememberSnapshot(snapshot);
    const task = taskFromRun(snapshot);
    setTasks((items) => items.some((item) => item.runId === snapshot.id) ? items.map((item) => item.runId === snapshot.id ? task : item) : [task, ...items]);
    setHistory((items) => items.filter((entry) => entry.runId !== snapshot.id));
  };
  const approveTask = async (task: RunningTask, mode: "once" | "always" = "once", emailEdit?: { subject: string; body: string }, retryNative = false) => {
    if (!task.runId) return false;
    if (task.nativeAction) {
      return appleExecutor.current.execute(appleActionKey(task), async () => {
        const result = await requestNativeApple("execute", { runId: task.runId, actionId: task.actionId });
        if (!result.snapshot) throw new Error("The iPhone result has not returned yet.");
        replaceTask(result.snapshot);

        return true;
      }, retryNative);
    }
    const approve = async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/runs/${task.runId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        if (emailEdit) throw new Error(await responseError(response, "The edited email could not be approved. Your changes are still here."));
        return false;
      }
      replaceTask(await response.json() as AgentRunSnapshot);
      return true;
    };
    if (task.approvalKind === "reconnect") {
      if (await approve({ actionId: task.actionId })) return true;
      if (hasNativeBridge()) {
        await requestNativeGoogleReconnect(task.runId);
        if (await approve({ actionId: task.actionId })) return true;
        throw new Error("Google reconnected, but this task could not resume. Try again.");
      }
      const callback = new URL(window.location.href);
      callback.searchParams.set("googleReconnectRun", task.runId);
      await signIn("google", { callbackUrl: callback.toString() });
      return true;
    }
    return approve({ actionId: task.actionId, mode, emailEdit });
  };
  const finishBrowserTakeover = async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}/approve`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserTakeoverDone: true }),
    });
    if (!response.ok) return false;
    replaceTask(await response.json() as AgentRunSnapshot);
    return true;
  };
  const skipTaskAttention = async (task: RunningTask) => {
    if (!task.runId || !task.actionId) throw new Error("This request is no longer waiting.");
    const response = await fetch(`/api/runs/${task.runId}/skip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: task.actionId }) });
    if (!response.ok) throw new Error(await responseError(response, "The agent could not try another route."));
    replaceTask(await response.json() as AgentRunSnapshot);
  };
  const reply = async (runId: string, text: string, files: File[] = [], replyTo?: string) => {
    const snapshot = snapshotsRef.current.get(runId);
    const task = tasksRef.current.find(item => item.runId === runId);
    const entry = history.find(item => item.runId === runId);
    const key = conversationKey(snapshot?.decisionId ?? task?.decisionId ?? entry?.decisionId ?? undefined, runId);
    const rollbackPreview = conversationSettings.publishOutgoing(key, text || (files.length === 1 ? 'Attachment' : `${files.length} attachments`));
    try {
      const response = await fetch(`/api/runs/${runId}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, appleConnections: await currentAppleConnections(), files: await encodeChatFiles(files), ...(replyTo ? { replyTo } : {}) }) });
      if (!response.ok) throw new Error(await responseError(response, "Your reply could not be sent."));
      replaceTask(await response.json() as AgentRunSnapshot);
      void conversationSettings.refresh().catch(() => {});
    } catch (error) { rollbackPreview(); throw error; }
  };
  const stopRun = async (runId: string) => {
    if (previewMode) return;
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    if (!response.ok) throw new Error(await responseError(response, "The task couldn’t be stopped. Try again."));
    replaceTask(await response.json() as AgentRunSnapshot);
  };
  const cancelTask = async (task: RunningTask, disposition: "discard" | "done" | "save") => {
    if (task.runId) {
      const response = await fetch(`/api/runs/${task.runId}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response, "The task could not be canceled"));
    }
    setTasks((items) => items.filter((item) => item.id !== task.id));
    setBrowserSheet((sheet) => sheet?.runId === task.runId ? null : sheet);
    if (disposition === "done") {
      const entry = completedHistoryFromTask(task);
      setDecisions((items) => items.filter((decision) => decision.id !== task.decisionId && decision.activeRunId !== task.runId));
      setHistory((items) => [entry, ...items.filter((item) => item.id !== entry.id)]);
    } else if (disposition === "discard") {
      setDecisions((items) => items.filter((decision) => decision.id !== task.decisionId && decision.activeRunId !== task.runId));
      setDiscardedDecisionIds((items) => items.includes(task.decisionId) ? items : [...items, task.decisionId]);
    } else {
      setDecisions((items) => items.map((decision) => decision.id === task.decisionId || decision.activeRunId === task.runId ? { ...decision, activeRunId: undefined, selectedOption: undefined } : decision));
    }
    if (disposition !== "save") back();
  };
  const retry = async (decision: Decision, entryId?: string, runId?: string) => {
    if (runId) {
      await reply(runId, "Try again.");
      return true;
    }
    const option = decision.options[0];
    if (!option) return false;
    setDiscardedDecisionIds((items) => items.filter((id) => id !== decision.id));
    const started = await resolveDecision(decision, option);
    if (started) {
      if (entryId) setHistory((items) => items.filter((entry) => entry.id !== entryId));
      openTask(decision.id);
    }
    return started;
  };

  const refreshConversations = async () => {
    if (previewMode) return;
    // Read saved data only: this never invokes discovery or starts agent work.
    const [remote] = await Promise.all([store.refresh(), conversationSettings.refresh()]);
    const data: { snapshots: AgentRunSnapshot[] } = { snapshots: [] };
    let cursor = '';
    while (true) {
      const response = await fetch(`/api/schedules/updates${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Couldn’t refresh conversations.');
      const page = await response.json() as { snapshots: AgentRunSnapshot[]; cursor: string };
      data.snapshots.push(...page.snapshots);
      if (page.snapshots.length < 100 || page.cursor === cursor) break;
      cursor = page.cursor;
    }
    const runIds = [...new Set([...tasks, ...(remote?.tasks ?? [])].flatMap(task => task.runId ? [task.runId] : []))];
    for (let index = 0; index < runIds.length; index += 6) {
      const current = await Promise.all(runIds.slice(index, index + 6).map(async id => {
        const result = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        if (result.status === 404) return null;
        if (!result.ok) throw new Error('Couldn’t refresh conversations.');
        return await result.json() as AgentRunSnapshot;
      }));
      data.snapshots.push(...current.filter((snapshot): snapshot is AgentRunSnapshot => Boolean(snapshot)));
    }
    for (const snapshot of data.snapshots) {
      if ((snapshotsRef.current.get(snapshot.id)?.updatedAt ?? '') > snapshot.updatedAt) continue;
      rememberSnapshot(snapshot);
      if (['done', 'failed', 'cancelled'].includes(snapshot.status)) {
        setTasks(items => items.filter(item => item.runId !== snapshot.id));
        setHistory(items => [historyFromRun(snapshot), ...items.filter(item => item.runId !== snapshot.id)]);
      } else {
        setTasks(items => [taskFromRun(snapshot), ...items.filter(item => item.runId !== snapshot.id)]);
        setHistory(items => items.filter(item => item.runId !== snapshot.id));
      }
      setDecisions(items => items.filter(item => item.activeRunId !== snapshot.id && item.id !== snapshot.decisionId));
    }
  };

  // Scheduled work can wake a thread after its live stream has closed.
  useEffect(() => {
    if (!ready || previewMode) return;
    const controller = new AbortController();
    let cursor = "";
    let polling = false;
    const seen = new Map<string, string>();
    const poll = async () => {
      if (polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const response = await fetch(`/api/schedules/updates${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { snapshots: AgentRunSnapshot[]; cursor: string };
        if (controller.signal.aborted) return;
        cursor = data.cursor;
        for (const snapshot of data.snapshots) {
          if (seen.get(snapshot.id) === snapshot.updatedAt || (snapshotsRef.current.get(snapshot.id)?.updatedAt ?? "") > snapshot.updatedAt) continue;
          seen.set(snapshot.id, snapshot.updatedAt);
          rememberSnapshot(snapshot);
          if (["done", "failed", "cancelled"].includes(snapshot.status)) {
            setTasks(items => items.filter(item => item.runId !== snapshot.id));
            setHistory(items => [historyFromRun(snapshot), ...items.filter(item => item.runId !== snapshot.id)]);
          } else {
            const task = taskFromRun(snapshot);
            setTasks(items => [task, ...items.filter(item => item.runId !== snapshot.id)]);
            setHistory(items => items.filter(item => item.runId !== snapshot.id));
          }
          setDecisions(items => items.filter(item => item.activeRunId !== snapshot.id && item.id !== snapshot.decisionId));
        }
      } catch { /* Offline: the next visible poll recovers persisted deliveries. */ }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    const refresh = () => { void poll(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [ready, previewMode]);

  useEffect(() => {
    if (!remoteRunIds || previewMode) return;
    const sources = remoteRunIds.split(",").map((runId) => {
      const source = new EventSource(`/api/runs/${runId}/events`);
      source.addEventListener("snapshot", (event) => {
        const snapshot = rememberSnapshot(JSON.parse((event as MessageEvent).data) as AgentRunSnapshot);
        if (snapshot.status === "done" || snapshot.status === "failed") {
          setTasks((items) => items.filter((item) => item.runId !== snapshot.id));
          const decision = decisionsRef.current.find((item) => item.id === snapshot.decisionId || item.activeRunId === snapshot.id);
          const task = tasksRef.current.find((item) => item.runId === snapshot.id);
          const completedAt = snapshot.completedAt ?? snapshot.updatedAt;
          let entry: HistoryEntry;
          if (snapshot.status === "failed") {
            entry = decision
              ? failedHistoryFromDecision(decision, { runId: snapshot.id, summary: "Dash couldn’t finish this task", details: snapshot.error ?? "The agent could not complete the requested outcome.", completedAt })
              : task ? failedHistoryFromTask(task, snapshot.error ?? "The agent could not complete the requested outcome.", undefined, completedAt) : historyFromRun(snapshot);
          } else if (snapshot.metadata.responseDisposition === "silent" || snapshot.metadata.responseDisposition === "reaction") {
            entry = historyFromRun(snapshot);
          } else if (decision) {
            const artifacts = snapshot.artifacts.filter((artifact) => !artifact.name.startsWith("browser-frame-")).map((artifact) => ({ id: artifact.id, runId: snapshot.id, name: artifact.name, mimeType: artifact.mimeType }));
            const resultDecision = { ...decision, activeRunId: undefined, result: snapshot.result ?? undefined, runArtifacts: artifacts };
            entry = decisionResultFailed(resultDecision)
              ? failedHistoryFromDecision(resultDecision, { runId: snapshot.id, summary: snapshot.result?.summary, details: snapshot.result?.details, result: snapshot.result ?? undefined, completedAt })
              : completedHistoryFromDecision(resultDecision, snapshot);
          } else if (task && snapshot.result?.outcome === "needs_user") {
            entry = failedHistoryFromTask(task, snapshot.result.details, snapshot.result, completedAt);
          } else {
            entry = historyFromRun(snapshot);
          }
          entry = { ...withConversationIdentity(entry, snapshot), activityAt: taskFromRun(snapshot).activityAt };
          if (decision) setDecisions((items) => items.filter((item) => item.id !== decision.id));
          setHistory((items) => [entry, ...items.filter((item) => item.id !== entry.id)]);
          source.close();
        } else if (snapshot.status === "cancelled") {
          setTasks((items) => items.filter((item) => item.runId !== snapshot.id));
          setDecisions((items) => items.map((decision) => decision.activeRunId === snapshot.id ? { ...decision, activeRunId: undefined, selectedOption: undefined } : decision));
          source.close();
        } else {
          setTasks((items) => items.map((item) => item.runId === snapshot.id ? taskFromRun(snapshot) : item));
        }
      });
      return source;
    });
    return () => sources.forEach((source) => source.close());
  }, [remoteRunIds, previewMode]);

  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const reconnectRunId = url.searchParams.get("googleReconnectRun");
    if (!reconnectRunId) return;
    const task = tasks.find((candidate) => candidate.runId === reconnectRunId && candidate.approvalKind === "reconnect");
    if (!task?.actionId) return;
    url.searchParams.delete("googleReconnectRun");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    void approveTask(task).catch((error) => console.error(error instanceof Error ? error.message : "Google reconnect could not resume the task"));
  }, [ready, tasks]);

  useEffect(() => {
    const chooseFromNative = (event: Event) => {
      const detail = (event as CustomEvent<{ decisionId: string; optionId: string }>).detail;
      if (!detail || typeof detail.decisionId !== "string" || typeof detail.optionId !== "string") return;
      const decision = decisions.find((candidate) => candidate.id === detail.decisionId && !candidate.activeRunId && !candidate.result);
      const option = decision?.options.find((candidate) => candidate.id === detail.optionId);
      if (!decision || !option) { postNativeMessage({ version: 1, action: "nativeChoiceResult", payload: { ...detail, started: false } }); return; }
      void resolveDecision(decision, option).then((started) => {
        postNativeMessage({ version: 1, action: "nativeChoiceResult", payload: { ...detail, started } });
      });
    };
    window.addEventListener("decisionFeed:nativeChoice", chooseFromNative);
    return () => window.removeEventListener("decisionFeed:nativeChoice", chooseFromNative);
  }, [decisions, modelSettings]);

  // Notification taps switch conversations in place instead of reloading the page.
  const openTaskRef = useRef(openTask);
  openTaskRef.current = openTask;
  useEffect(() => {
    const openFromNative = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id === "string" && id.length > 0 && id.length <= 200) openTaskRef.current(id);
    };
    window.addEventListener("decisionFeed:openConversation", openFromNative);
    postNativeMessage({ version: 1, action: "openConversationSupported", payload: {} });
    return () => window.removeEventListener("decisionFeed:openConversation", openFromNative);
  }, []);

  /* ---------- scanning ---------- */
  const finishInitialScan = async (job: ManualScanJob) => {
    const response = await INITIAL_SCAN("complete");
    const result = response?.ok ? await response.json() as { completed?: boolean } : null;
    if (result?.completed) setInitialScanFinished(true);
    if (result?.completed && job.status === "completed" && job.result?.decisionCount === 0 && !job.result.warnings?.length) setEmptyFirstScan(job.id);
  };
  const scanning = scanJobId ? scanStatus : null;
  const startScanJob = async (body: Record<string, unknown>, queuedLabel: string, runningLabel: string) => {
    const response = await fetch("/api/manual-scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userTimeZone: browserTimeZone(), deviceCalendarEvents: deviceCalendar.events, ...body }) });
    if (!response.ok) throw new Error(await responseError(response, "The background scan could not be started"));
    const { job } = await response.json() as { job?: ManualScanJob };
    if (!job?.id) throw new Error("The background scan did not return a job.");
    setScanJobId(job.id);
    setScanStatus(job.status === "running" ? runningLabel : queuedLabel);
  };
  const stopScan = async () => {
    if (!scanJobId) { setConfirmError("The scan is still starting. Try again in a moment."); return false; }
    if (previewMode) { setScanJobId(null); setScanStatus(null); return true; }
    const response = await fetch(`/api/manual-scans?id=${encodeURIComponent(scanJobId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await responseError(response, "The scan could not be stopped"));
    const { job } = await response.json() as { job?: ManualScanJob | null };
    if (job?.status !== "cancelled" && job?.status !== "completed" && job?.status !== "failed") throw new Error("The scan could not be stopped. Try again.");
    setScanJobId(null); setScanStatus(null);
    await INITIAL_SCAN("complete");
    window.dispatchEvent(new Event("focus"));
    return true;
  };
  useEffect(() => {
    if (!ready || scanJobId || previewMode) return;
    let cancelled = false;
    void fetch("/api/manual-scans", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ job?: ManualScanJob | null }> : { job: null })
      .then(async ({ job }) => {
        if (cancelled || !job) return;
        if (job.status === "completed") { await finishInitialScan(job); return; }
        if ((job.status !== "queued" && job.status !== "running")) return;
        setScanJobId(job.id);
        setScanStatus(job.status === "running" ? "Scanning safely in the background" : "Background scan queued");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready, scanJobId, previewMode]);
  useEffect(() => {
    if (!scanJobId || previewMode) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      const response = await fetch(`/api/manual-scans?id=${encodeURIComponent(scanJobId)}`, { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (!response?.ok) { timer = window.setTimeout(poll, 2_500); return; }
      const { job } = await response.json() as { job?: ManualScanJob | null };
      if (!job) { setScanJobId(null); setScanStatus(null); await INITIAL_SCAN("retry"); return; }
      if (job.status === "queued" || job.status === "running") {
        setScanStatus(job.status === "running" ? "Scanning safely in the background" : "Background scan queued");
        if (job.status === "running") window.dispatchEvent(new Event("focus"));
        timer = window.setTimeout(poll, 2_000);
        return;
      }
      setScanJobId(null); setScanStatus(null);
      if (job.status === "completed" || job.status === "cancelled") { await finishInitialScan(job); window.dispatchEvent(new Event("focus")); }
      else { await INITIAL_SCAN("retry"); console.error(job.error || "Inbox and calendar scan failed"); }
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [scanJobId, previewMode]);
  useEffect(() => {
    const sourceConnected = googleConnected || iCloudConnected || deviceCalendar.status === "authorized";
    if (!ready || previewMode || !sourceConnected || initialScanActiveRef.current) return;
    void (async () => {
      const claimResponse = await INITIAL_SCAN("claim");
      if (!claimResponse?.ok || !(await claimResponse.json() as { claimed?: boolean }).claimed) return;
      initialScanActiveRef.current = true;
      try {
        setScanStatus("Preparing your first background scan");
        await startScanJob({ forceFullScan: true }, "First scan queued", "Checking your connected sources in the background");
      } catch { setScanStatus(null); await INITIAL_SCAN("retry"); }
      finally { initialScanActiveRef.current = false; }
    })();
  }, [ready, previewMode, googleConnected, iCloudConnected, initialScanSignal, deviceCalendar.status, deviceCalendar.events]);
  useEffect(() => {
    if (!ready || !googleConnected || new URLSearchParams(window.location.search).get("connected") !== "1") return;
    void (async () => {
      try {
        const response = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify({ existingDecisions: scanContext(decisions, tasks, history, discardedDecisionIds), userTimeZone: browserTimeZone(), deviceCalendarEvents: deviceCalendar.events }) });
        const result = await readGoogleScan(response, (decision) => setDecisions((current) => mergeScannedDecisions(current, [decision], discardedDecisionIds)));
        setDecisions((current) => mergeScannedDecisions(current, result.decisions, discardedDecisionIds));
        const url = new URL(window.location.href);
        url.searchParams.delete("connected");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      } catch (error) { console.error(error instanceof Error ? error.message : "Google connected, but the first scan failed"); }
    })();
  }, [ready, googleConnected]);

  /* ---------- account, vault ---------- */
  const loadVaultItems = async () => {
    if (previewMode) return;
    setVaultLoading(true);
    try {
      const response = await fetch("/api/vault", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "Your secure vault could not be loaded."));
      setVaultItems((await response.json() as { items: VaultItemSummary[] }).items);
    } catch (error) { console.error(error instanceof Error ? error.message : "Your secure vault could not be loaded."); }
    finally { setVaultLoading(false); }
  };
  useEffect(() => { void loadVaultItems(); }, [previewMode]);
  const confirmSignOut = async () => {
    await unregisterNativePushToken();
    messageCache.current.clearSaved(); lifeProfile.clear();
    listCacheCleared.current = true; clearConversationList(user.email);

    const result = await signOut({ callbackUrl: "/", redirect: false });
    if (hasNativeBridge()) postNativeMessage({ version: 1, action: "signedOut" });
    else window.location.assign(result.url || "/");
  };
  const deleteAccountData = async (action: "data" | "account", confirmation: string) => {
    store.deletionRef.current = true;
    try {
      await store.saveQueueRef.current;
      if (hasNativeBridge()) await requestNativeVault("vaultDeleteAll", {});
      await unregisterNativePushToken();
      const response = await fetch(action === "account" ? "/api/account" : "/api/account/data", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation }) });
      if (!response.ok) throw new Error(await responseError(response, action === "account" ? "Your account could not be deleted." : "Your data could not be deleted."));

      const deletion = await response.json() as { cleanupPending?: boolean };
      if (action === "account" || deletion.cleanupPending) {
        messageCache.current.clearSaved(); lifeProfile.clear();
        listCacheCleared.current = true; clearConversationList(user.email);
         await signOut({ callbackUrl: "/", redirect: false });
        postNativeMessage({ version: 1, action: "signedOut" });
        window.location.assign("/");
        return;
      }
      messageCache.current.clearSaved(); lifeProfile.clear();
      listCacheCleared.current = true; clearConversationList(user.email);
      store.clearAll();
      setVaultItems([]); setSnapshots(new Map());
      postNativeMessage({ version: 1, action: "hapticSuccess" });
      window.location.assign("/?view=settings");
    } catch (error) {
      store.deletionRef.current = false;
      postNativeMessage({ version: 1, action: "hapticError" });
      throw error;
    }
  };
  /* ---------- confirmations ---------- */
  const runConfirm = (work: (input: string) => Promise<boolean | void>): ConfirmAction["run"] => async (input) => {
    setConfirmBusy(true); setConfirmError("");
    try { return await work(input); }
    catch (error) { setConfirmError(error instanceof Error ? error.message : "Something went wrong."); return false; }
    finally { setConfirmBusy(false); }
  };
  const confirmSheet = (() => {
    if (!confirm) return null;
    const close = () => { setConfirm(null); setConfirmError(""); };
    const sheet = (title: string, body: string, actions: ConfirmAction[], input?: { label: string; placeholder: string; expected: string }) => <ConfirmSheet title={title} body={body} actions={actions} input={input} busy={confirmBusy} error={confirmError} onClose={close} nativePrompt={confirm.kind === "dismiss" ? "Dismiss this suggestion?\n\nNo action will be taken. Keep going to choose an option instead." : undefined} />;
    switch (confirm.kind) {
      case "dismiss": {
        const decision = decisions.find((item) => item.id === confirm.decisionId);
        if (!decision) return null;
        const key = conversationKey(decision.id, decision.activeRunId);
        const autoArchive = (decision.dismissLabel || "Do nothing").trim().toLowerCase() === "do nothing" && !conversationSettings.settings[key]?.pinnedAt;
        const loop = /^not a (?:loop|promise)$/i.test(decision.dismissLabel || "");
        const learn = (kind: Parameters<typeof sendProactiveFeedback>[1]) => runConfirm(async () => { await sendProactiveFeedback(decision, kind); await dismiss(); });
        const dismiss = async () => {
            if (autoArchive && !await conversationSettings.apply({ key, action: "archive" })) throw new Error("The conversation could not be archived. Please try again.");
            const entry = historyFromDecision(decision, decision.dismissLabel || "Do nothing", "dismissed");
            setDecisions((items) => items.filter((item) => item.id !== decision.id));
            setHistory((items) => [entry, ...items]);
            setDiscardedDecisionIds((items) => items.includes(decision.id) ? items : [...items, decision.id]);
            if (autoArchive) {
              back();
            }
        };
        const teach = proactiveV2 && decision.sourceType !== "manual";
        return sheet(`${decision.dismissLabel || "Do nothing"}?`, autoArchive ? `“${decision.title}” will be archived. No action will be taken. You can restore it from Archived.` : `No action will be taken. “${decision.title}” stays in your conversations.`, [
          { label: decision.dismissLabel || "Do nothing", run: teach ? learn(loop ? "not_a_loop" : "dismissed") : runConfirm(dismiss) },
          { label: "Go back", tone: "text", run: () => undefined },
        ]);
      }
      case "cancel-task": {
        const task = tasks.find((item) => item.id === confirm.taskId);
        if (!task) return null;
        return sheet(`Stop “${task.title}”?`, "Dash stops working on it right away. You choose what happens to it.", [
          { label: "Mark done", run: runConfirm(() => cancelTask(task, "done")) },
          { label: "Discard", tone: "destructive", run: runConfirm(() => cancelTask(task, "discard")) },
          { label: "Keep working", tone: "text", run: () => undefined },
        ]);
      }
      case "stop-run":
        return sheet("Stop this task?", `Dash will stop working on “${confirm.title}”. Anything already done, like a sent email, won’t be undone.`, [
          { label: "Stop task", tone: "destructive", run: runConfirm(() => stopRun(confirm.runId)) },
          { label: "Keep going", tone: "text", run: () => undefined },
        ]);
      case "sign-out":
        return sheet("Sign out of Dash?", "Your tasks and history stay saved to this account.", [
          { label: "Sign out", run: runConfirm(confirmSignOut) },
          { label: "Stay signed in", tone: "text", run: () => undefined },
        ]);
      case "delete": {
        const account = confirm.action === "account";
        return sheet(account ? "Delete your account?" : "Delete all your data?", account
          ? "This permanently removes your account, disconnects Google, stops active tasks, and deletes your workspace, history, files, learned preferences and saved vault items."
          : "This disconnects your sources and permanently deletes your workspace, history, agent runs, files, learned preferences, notifications and saved vault items. Your Dash account remains.", [
          { label: account ? "Delete account" : "Delete all data", tone: "destructive", run: runConfirm((input) => deleteAccountData(confirm.action, input)) },
          { label: "Cancel", tone: "text", run: () => undefined },
        ], { label: account ? "Enter your account email to confirm" : "Type DELETE to confirm", placeholder: account ? user.email : "DELETE", expected: account ? user.email : "DELETE" });
      }
      case "stop-scan":
        return sheet("Stop this scan?", "Anything already found stays on Home.", [
          { label: "Stop scan", run: runConfirm(stopScan) },
          { label: "Keep scanning", tone: "text", run: () => undefined },
        ]);
      case "vault-delete":
        return sheet(`Delete “${confirm.item.label}”?`, "It is removed from your iPhone Keychain. Dash can no longer fill it in.", [
          { label: "Delete", tone: "destructive", run: runConfirm(async () => {
            if (previewMode) throw new Error("The preview vault is read-only.");
            await requestNativeVault("vaultDelete", { itemId: confirm.item.id });
            setVaultItems((items) => items.filter((candidate) => candidate.id !== confirm.item.id));
          }) },
          { label: "Keep", tone: "text", run: () => undefined },
        ]);
    }
  })();

  /* ---------- derived lists ---------- */
  const [savedConversations, setSavedConversations] = useState<{ email: string; snapshot: ConversationListSnapshot | null } | null>(null);
  useLayoutEffect(() => {
    setSavedConversations({ email: user.email, snapshot: previewMode ? null : readConversationList(user.email) });
  }, [user.email, previewMode]);
  const cachedConversations = savedConversations?.email === user.email ? savedConversations.snapshot : null;
  // Presentation readiness is independent from writable server state. The saved
  // list is account-scoped and never imported into the writable store.
  const homeVisible = ready || Boolean(cachedConversations);
  const announcedHome = useRef(false);
  useEffect(() => {
    if (!homeVisible || announcedHome.current) return;
    announcedHome.current = true;
    postNativeMessage({ version: 1, action: "workspaceReady", payload: { path: window.location.pathname, readyState: document.readyState, source: ready ? "remote" : "saved", decisionCount: decisions.length, taskCount: tasks.length } });
  }, [homeVisible, ready, decisions.length, tasks.length]);
  const conversationsReady = ready && store.hasRemoteState && conversationSettings.ready;
  const conversations = useMemo(() => {
    const snapshot = conversationsReady ? { decisions, tasks, history, settings: conversationSettings.settings, messages: conversationSettings.messages } : cachedConversations;
    return snapshot ? conversationItems(snapshot.decisions, snapshot.tasks, snapshot.history, now ?? undefined, snapshot.settings, snapshot.messages) : [];
  }, [decisions, tasks, history, now, conversationSettings.settings, conversationSettings.messages, conversationsReady, cachedConversations]);
  useLayoutEffect(() => {
    if (previewMode || !conversationsReady || store.deletionRef.current || listCacheCleared.current) return;
    saveConversationList(user.email, { decisions, tasks, history, settings: conversationSettings.settings, messages: conversationSettings.messages });
  }, [user.email, previewMode, conversationsReady, decisions, tasks, history, conversationSettings.settings, conversationSettings.messages]);
  const threadPrefetchKey = JSON.stringify(conversations.filter(item => item.runId).map(item => [item.runId, item.messageAt ?? '']));
  useEffect(() => {
    if (previewMode || !ready) return;
    let cancelled = false;
    const ids = JSON.parse(threadPrefetchKey) as [string, string][];
    const worker = async () => {
      while (!cancelled && ids.length) {
        const [id, version] = ids.shift()!;
        try { await cachedThreads.prefetch(id, version); } catch { /* Opening the chat retries. */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    return () => { cancelled = true; };
  }, [threadPrefetchKey, cachedThreads, previewMode, ready]);
  const discoveryAvailable = googleConnected || iCloudConnected || deviceCalendar.status === 'authorized';
  const fallbackActive = firstUseFallbackEligible({ firstUse: firstUse === true, ready: conversationsReady, visibleCount: conversations.filter(item => !item.archived).length, scanning: Boolean(scanning), scanFinished: initialScanFinished, sourceConnected: discoveryAvailable, sourcesLoaded: mailSourcesLoaded });
  const visibleConversation = useMemo(() => {
    if (screen.kind !== "task") return undefined;
    const direct = conversations.find(item => item.id === screen.id);
    if (direct) return direct;
    const task = tasks.find(item => item.runId === screen.id || item.decisionId === screen.id);
    const entry = history.find(item => item.runId === screen.id || item.decisionId === screen.id);
    const key = task ? conversationKey(task.decisionId, task.runId, task.id) : entry ? conversationKey(entry.decisionId, entry.runId, entry.id) : conversationKey(screen.id);
    return conversations.find(item => item.key === key);
  }, [screen, conversations, tasks, history]);
  useEffect(() => {
    if (!visibleConversation?.key || !visibleConversation.unread) return;
    const { key, messageAt } = visibleConversation;
    const markRead = () => {
      if (!document.hidden && !browserSheet && !calendarContext && !confirm) void conversationSettings.apply({ key, action: "read", through: messageAt ?? new Date().toISOString() });
    };
    markRead();
    const timer = window.setInterval(markRead, 5_000);
    document.addEventListener("visibilitychange", markRead);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", markRead); };
  }, [visibleConversation?.key, visibleConversation?.messageAt, visibleConversation?.unread, conversationSettings.apply, browserSheet, calendarContext, confirm]);

  const markDisplayedMessagesRead = useCallback((key: string, through: string) => {
    if (!document.hidden && !browserSheet && !calendarContext && !confirm) void conversationSettings.apply({ key, action: "read", through });
  }, [conversationSettings.apply, browserSheet, calendarContext, confirm]);

  useEffect(() => {
    const w = window as Window & { __dashPendingGoogleReconnect?: boolean };
    const receive = () => { delete w.__dashPendingGoogleReconnect; open({ kind: "you", panel: "sources" }); };
    window.addEventListener("decisionFeed:googleReconnectNeeded", receive);
    if (w.__dashPendingGoogleReconnect) receive();
    return () => window.removeEventListener("decisionFeed:googleReconnectNeeded", receive);
  }, [open]);

  const initial = user.name.trim()[0]?.toUpperCase() || user.email[0]?.toUpperCase() || "U";
  const browserTask = browserSheet ? tasks.find((task) => task.runId === browserSheet.runId) : undefined;
  const browserSnapshot = browserSheet ? snapshots.get(browserSheet.runId) : undefined;
  const browserFrames = browserTask?.browserFrames ?? (browserSnapshot ? taskFromRun(browserSnapshot).browserFrames ?? [] : []);

  const taskActions: TaskActions = {
    onEntryReaction: async (entry, messageId, emoji) => {
      setHistory(entries => entries.map(item => item.id !== entry.id ? item : {
        ...item, messageReactions: { ...item.messageReactions, [messageId]: [
          ...(item.messageReactions?.[messageId] ?? []).filter(reaction => reaction.actor !== "user"),
          ...(emoji ? [{ actor: "user" as const, emoji, createdAt: new Date().toISOString() }] : []),
        ] },
      }));
    },
    onConversationAction: conversationSettings.apply,
    onReactionPreview: (key, emoji) => conversationSettings.publishOutgoing(key, emoji ? `You reacted ${emoji}` : 'You removed a reaction', true),
    onRead: markDisplayedMessagesRead,
    unreadCount: conversations.reduce((total, item) => total + (item.unread && !item.archived && item.key !== visibleConversation?.key ? item.unreadCount ?? 1 : 0), 0),
    onBack: back,
    onChoose: resolveDecision,
    onCustom: resolveCustomInstruction,
    onDismiss: (decision) => setConfirm({ kind: "dismiss", decisionId: decision.id }),
    onCalendar: (decision, date) => setCalendarContext({ decision, date }),
    onApprove: approveTask,
    onSkip: skipTaskAttention,
    onReplaceTask: replaceTask,
    onReply: reply,
    onContinue: async (entry, text, files) => {
      const decision: Decision = { ...(entry.retryDecision ?? { sourceType: "manual", urgency: "medium", options: [], dismissLabel: "Not now", createdAt: new Date().toISOString() }), id: entry.decisionId ?? entry.id, category: entry.category, title: entry.title, subtitle: entry.contextSummary || entry.subtitle, originalContext: `${entry.originalContext}\nPrevious choice: ${entry.chosenOption}\nPrevious outcome: ${entry.outcome}`, activeRunId: undefined, result: undefined };
      await startRun(decision, { id: "continue", label: text, actionType: "approval" }, undefined, text, { files, metadata: { userMessage: text, previousConversation: historyThreadItems(entry).flatMap(item => item.kind === "agent" || item.kind === "user"
        ? [{ role: item.kind === "agent" ? "assistant" : "user", text: item.text, reactions: item.reactions }] : []) } });
      setHistory((entries) => entries.filter((item) => item.id !== entry.id));
      openTask(decision.id);
    },
    onCancel: (task) => setConfirm({ kind: "cancel-task", taskId: task.id }),
    onStop: (runId, title) => setConfirm({ kind: "stop-run", runId, title }),
    onOpenBrowser: (runId, control, frameId) => {
      const snapshot = snapshotsRef.current.get(runId);
      const task = tasksRef.current.find(item => item.runId === runId);
      const knownItems = [...(messageCache.current.get(runId) ?? []), ...(snapshot?.threadItems ?? [])];
      setBrowserSheet({ runId, control, frameId, attention: {
        actionId: task?.status === "needs_approval" ? task.actionId : undefined,
        agentMessageIds: knownItems.filter(item => item.kind === "agent").map(item => item.id),
        openedAt: Date.now(),
      } });
    },
    onRetry: retry,
    onSnapshot: rememberSnapshot,
    onThreadItems: (key, items) => {
      const latest = items.findLast(item => (item.kind === 'agent' || item.kind === 'user') && Boolean(item.text.trim()) && Boolean(item.createdAt));
      if (latest && (latest.kind === 'agent' || latest.kind === 'user') && latest.createdAt) conversationSettings.publishReceived(key, { kind: latest.kind, text: latest.text.slice(0, 500), createdAt: latest.createdAt });
    },
  };

  return (
    <div ref={rootRef} className="wd" data-native={nativeShell || undefined}>
      <div className="wd-main">
      {!previewMode && tasks.filter(task => task.nativeAction && task.actionId && task.runId).map(task => <AppleActionRunner key={appleActionKey(task)} task={task} execute={approveTask} />)}

      <div className={`wd-home-layer${screen.kind === "home" ? " is-current" : ""}`} inert={screen.kind !== "home"} aria-hidden={screen.kind !== "home"}>
        <Home firstUse={fallbackActive} suggestionHintPreview={previewMode && previewScanState === "arriving"} ownerEmail={previewMode ? undefined : user.email} googleConnections={googleConnections} nativeChromeActive={screen.kind === "home" || screen.kind === "you"} name={user.name} onRefresh={refreshConversations} pendingInitialData={!conversationsReady && !cachedConversations} onArchive={() => open({ kind: "archive" })} previewMode={previewMode} active={screen.kind === "home" && !browserSheet && !calendarContext && !confirm} onAction={conversationSettings.apply} actionsReady={store.hasRemoteState && conversationSettings.ready && !conversationSettings.busy} actionError={conversationSettings.error} image={user.image} initial={initial} items={previewMode && previewScanState === "arriving" ? conversationItems(decisions, [], [], now ?? undefined).slice(0, previewFoundCount) : conversations} scanning={scanning} emptyFirstScan={emptyFirstScan} onSuggest={draft => { setHomeText(draft); setHomeError(null); setHomeFocusRequest(request => request + 1); }} onChoose={async (item, optionId, selectedOptionIds) => {
          if (item.feedQuestion && item.runId) {
            const task = tasks.find(candidate => candidate.runId === item.runId && candidate.actionId === item.feedQuestion!.actionId);
            const question = task?.questionRequest?.questions.find(candidate => candidate.id === item.feedQuestion!.questionId);
            const chosen = selectedOptionIds ?? [optionId];
            if (!task || !question || !["single_choice", "multiple_choice"].includes(question.answerType) || !chosen.length || chosen.some(id => !question.options.some(option => option.id === id)) || (question.answerType === "single_choice" && chosen.length !== 1)) return false;
            const response = await fetch(`/api/runs/${item.runId}/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: task.actionId, responses: [{ questionId: question.id, selectedOptionIds: chosen, text: "" }] }) });
            if (!response.ok) return false;
            replaceTask(await response.json() as AgentRunSnapshot);
            return true;
          }
          const decision = decisions.find(candidate => candidate.id === item.id && !candidate.activeRunId && !candidate.result);
          const option = decision?.options.find(candidate => candidate.id === optionId);
          if (!decision || !option) return false;
          if (previewMode && !optionNeedsNoAgent(option)) return true;
          const started = await resolveDecision(decision, option);
          return started;
        }} onOpen={(item) => openTask(item.id)} onYou={() => open({ kind: "you" })} />
        <Composer nativeChromeActive={screen.kind === "home" || screen.kind === "you"} active={screen.kind === "home"} variant="home" disabled={!store.hasRemoteState} placeholder="Message Dash…" value={homeText} onChange={setHomeText} focusRequest={homeFocusRequest} sending={homeSending} error={homeError} files={homeFiles} onRemoveFile={index => setHomeFiles(current => current.filter((_, i) => i !== index))} fileCount={homeFiles.length} fileBytes={homeFiles.reduce((total, file) => total + file.size, 0)} onFiles={incoming => setHomeFiles(current => [...current, ...incoming])} onSend={async (message) => {
          const text = message.trim();
          if (!store.hasRemoteState || (!text && homeFiles.length === 0) || homeSending) return false;
          setHomeSending(true); setHomeError(null);
          setHomeFiles([]);
          try { await startConversationTurn(text, homeFiles); return true; }
          catch (error) { setHomeFiles(current => current.length ? current : homeFiles); setHomeError(error instanceof Error ? error.message : "Your request could not be sent. Try again."); return false; }
          finally { setHomeSending(false); }
        }} />
      </div>
      {screen.kind !== "home" && screen.kind !== "you" && <div className="wd-front-layer">
      {screen.kind === "archive" && <Home pendingInitialData={!conversationsReady && !cachedConversations} archived onBack={back} previewMode={previewMode} active={!browserSheet && !calendarContext && !confirm} onAction={conversationSettings.apply} actionsReady={store.hasRemoteState && conversationSettings.ready && !conversationSettings.busy} actionError={conversationSettings.error} image={user.image} initial={initial} items={conversations} onChoose={async (item, optionId, selectedOptionIds) => {
          if (item.feedQuestion && item.runId) {
            const task = tasks.find(candidate => candidate.runId === item.runId && candidate.actionId === item.feedQuestion!.actionId);
            const question = task?.questionRequest?.questions.find(candidate => candidate.id === item.feedQuestion!.questionId);
            const chosen = selectedOptionIds ?? [optionId];
            if (!task || !question || !["single_choice", "multiple_choice"].includes(question.answerType) || !chosen.length || chosen.some(id => !question.options.some(option => option.id === id)) || (question.answerType === "single_choice" && chosen.length !== 1)) return false;
            const response = await fetch(`/api/runs/${item.runId}/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: task.actionId, responses: [{ questionId: question.id, selectedOptionIds: chosen, text: "" }] }) });
            if (!response.ok) return false;
            replaceTask(await response.json() as AgentRunSnapshot);
            return true;
          }
          const decision = decisions.find(candidate => candidate.id === item.id && !candidate.activeRunId && !candidate.result);
          const option = decision?.options.find(candidate => candidate.id === optionId);
          if (!decision || !option) return false;
          if (previewMode && !optionNeedsNoAgent(option)) return true;
          const started = await resolveDecision(decision, option);
          return started;
        }} onOpen={(item) => openTask(item.id)} onYou={() => open({ kind: "you" })} />}
      {screen.kind === "task" && <TaskRoute key={screen.id} id={screen.id} messageCache={messageCache.current} conversationSettings={conversationSettings.settings} decisions={decisions} tasks={tasks} history={history} snapshots={snapshots} previewMode={previewMode} actions={taskActions} pendingStart={pendingStart?.id === screen.id ? { ...pendingStart, retrying: homeSending, onRetry: async () => { setHomeSending(true); try { await startConversationTurn(pendingStart.request, pendingStart.files, pendingStart.id); setHomeText(""); setHomeFiles([]); } catch { /* Keep the draft and error for retry. */ } finally { setHomeSending(false); } } } : undefined} />}
      </div>}
      </div>
      {screen.kind === "you" && (
        <SettingsSheet
          lifeProfile={lifeProfile.data} onLifeProfile={lifeProfile.update}
          user={user} onProfilePhotoChanged={profilePhoto.update} panel={screen.panel} googleConnections={googleConnections} googleConnected={googleConnected} previewMode={previewMode} deviceCalendar={deviceCalendar}
          vaultItems={vaultItems} vaultLoading={vaultLoading} onVaultChanged={loadVaultItems} onVaultDelete={(item) => setConfirm({ kind: "vault-delete", item })}
          appearance={appearance} onAppearance={store.setAppearance}
          scanning={scanning} onStopScan={() => setConfirm({ kind: "stop-scan" })}
          onClose={back}
          onDeleteData={() => setConfirm({ kind: "delete", action: "data" })} onDeleteAccount={() => setConfirm({ kind: "delete", action: "account" })} onSignOut={() => setConfirm({ kind: "sign-out" })}
          savings={savingsThisYear(history)}
        />
      )}
      {browserSheet && (
        <BrowserSheet
          key={`${browserSheet.runId}-${browserSheet.frameId ?? ""}`}
          runId={browserSheet.runId} task={browserTask} frames={browserFrames} actions={browserSnapshot?.actions} control={browserSheet.control} frameId={browserSheet.frameId}
          closeForAttention={shouldCloseBrowserForAttention(browserSheet.attention, browserTask, browserSnapshot, browserSheet.control)}
          onControlChange={(control) => setBrowserSheet((sheet) => sheet ? { ...sheet, control, frameId: undefined } : sheet)}
          onDone={() => finishBrowserTakeover(browserSheet.runId)}
          onClose={() => setBrowserSheet(null)}
        />
      )}
      {calendarContext && <CalendarSheet decision={calendarContext.decision} initialDay={calendarContext.date} deviceEvents={deviceCalendar.events} googleConnected={googleConnected && !previewMode} onClose={() => setCalendarContext(null)} />}
      {confirmSheet}
    </div>
  );
}
