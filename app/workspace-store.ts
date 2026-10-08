"use client";
import { useEffect, useRef, useState } from "react";
import type { Decision, HistoryEntry, RunningTask, WorkspaceAppearance, WorkspaceModelSettings, WorkspacePreferences, WorkspaceStateData } from "../lib/types";
import type { AgentRunSnapshot } from "../lib/harness/types";
import { postNativeMessage, responseError } from "./native-bridge";
import { uiPreviewDecisions, uiPreviewHistory, uiPreviewTasks } from "./preview-fixtures";
import {
  completedHistoryFromDecision, decisionIsCurrent, decisionResultFailed, defaultModelSettings, displayTime, failedHistoryFromDecision, historyCompletedAt,
  mergeWorkspaceState, modelDefaultVersion, normalizedWorkspaceState, supportedModelSettings,
  type ModelSettings, type StoredModelSettings, type WorkspaceStateResponse,
} from "./workspace-model";

const EMPTY_STATE: WorkspaceStateData = { decisions: [], tasks: [], history: [], discardedDecisionIds: [] };

function serialize(state: WorkspaceStateData, appearance: WorkspaceAppearance, modelSettings: ModelSettings) {
  const preferences: WorkspacePreferences = { appearance, modelSettings: { ...modelSettings, defaultVersion: modelDefaultVersion } satisfies WorkspaceModelSettings };
  return { preferences, serialized: JSON.stringify({ state, preferences }) };
}

/**
 * The persisted workspace: decisions, tasks, history, dismissed ids and the two
 * preferences. Hydrates from `/api/workspace/state`, saves with a 350ms debounce
 * and optimistic versioning, polls every 15s while visible, and imports the
 * legacy localStorage cache exactly once.
 */
export function useWorkspaceStore(previewMode: boolean, email: string) {
  const [decisions, setDecisions] = useState<Decision[]>(previewMode ? uiPreviewDecisions : []);
  const [tasks, setTasks] = useState<RunningTask[]>(previewMode ? uiPreviewTasks : []);
  const [history, setHistory] = useState<HistoryEntry[]>(previewMode ? uiPreviewHistory : []);
  const [discardedDecisionIds, setDiscardedDecisionIds] = useState<string[]>([]);
  const [appearance, setAppearance] = useState<WorkspaceAppearance>("system");
  const [modelSettings, setModelSettings] = useState<ModelSettings>(defaultModelSettings);
  const [ready, setReady] = useState(previewMode);
  const [hasRemoteState, setHasRemoteState] = useState(previewMode);
  const [modelSettingsLoaded, setModelSettingsLoaded] = useState(previewMode);
  const [saveRetry, setSaveRetry] = useState(0);
  const [migratedFailureId, setMigratedFailureId] = useState<string | null>(null);
  const versionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastPersistedRef = useRef("");
  const deletionRef = useRef(false);
  const dateHydrationRef = useRef<Set<string>>(new Set());
  const currentState = useRef({ decisions, tasks, history, discardedDecisionIds, appearance, modelSettings });
  currentState.current = { decisions, tasks, history, discardedDecisionIds, appearance, modelSettings };
  const refresh = async () => {
    if (previewMode || deletionRef.current) return;
    const response = await fetch("/api/workspace/state", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Couldn’t refresh conversations.");
    const remote = await response.json() as WorkspaceStateResponse;
    if (deletionRef.current) return;
    if (remote.version <= versionRef.current) return remote.state;
    const latest = currentState.current;
    const local = { decisions: latest.decisions, tasks: latest.tasks, history: latest.history, discardedDecisionIds: latest.discardedDecisionIds };
    if (serialize(local, latest.appearance, latest.modelSettings).serialized !== lastPersistedRef.current) {
      const merged = mergeWorkspaceState(local, remote.state);
      setDecisions(merged.decisions); setTasks(merged.tasks); setHistory(merged.history); setDiscardedDecisionIds(merged.discardedDecisionIds);
      setSaveRetry(value => value + 1);
    } else applyRemote(remote);
    return remote.state;
  };
  const storageKey = `decision-feed-state-v2:${email.toLowerCase()}`;

  const applyRemote = (remote: WorkspaceStateResponse) => {
    setHasRemoteState(true);
    const normalized = normalizedWorkspaceState(remote.state);
    const loadedModel = supportedModelSettings(remote.preferences.modelSettings) ?? defaultModelSettings;
    setDecisions(normalized.state.decisions);
    setTasks(normalized.state.tasks);
    setHistory(normalized.state.history);
    setDiscardedDecisionIds(normalized.state.discardedDecisionIds);
    setAppearance(remote.preferences.appearance);
    setModelSettings(loadedModel);
    versionRef.current = remote.version;
    lastPersistedRef.current = serialize(normalized.state, remote.preferences.appearance, loadedModel).serialized;
    return normalized.migratedFailureId;
  };

  useEffect(() => {
    if (previewMode || deletionRef.current) return;
    let cancelled = false;
    const hydrate = async () => {
      try {
        const response = await fetch("/api/workspace/state", { cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response, "Your saved workspace could not be loaded."));
        let remote = await response.json() as WorkspaceStateResponse;
        if (!remote.exists) {
          let legacyState: WorkspaceStateData = EMPTY_STATE;
          const legacyStateRaw = localStorage.getItem(storageKey);
          if (legacyStateRaw) {
            try {
              const parsed = JSON.parse(legacyStateRaw) as Partial<WorkspaceStateData>;
              if (Array.isArray(parsed.decisions) && Array.isArray(parsed.tasks) && Array.isArray(parsed.history)) {
                legacyState = { decisions: parsed.decisions, tasks: parsed.tasks, history: parsed.history, discardedDecisionIds: Array.isArray(parsed.discardedDecisionIds) ? parsed.discardedDecisionIds : [] };
              }
            } catch { /* A malformed legacy cache is intentionally not imported. */ }
          }
          const legacyAppearance = localStorage.getItem("wdyt-appearance");
          const importedAppearance: WorkspaceAppearance = legacyAppearance === "light" || legacyAppearance === "dark" ? legacyAppearance : "system";
          let importedModel = defaultModelSettings;
          const legacyModelRaw = localStorage.getItem("decision-feed-model-v1");
          if (legacyModelRaw) {
            try { importedModel = supportedModelSettings(JSON.parse(legacyModelRaw) as StoredModelSettings) ?? defaultModelSettings; }
            catch { /* Keep the current safe default. */ }
          }
          const preferences: WorkspacePreferences = { appearance: importedAppearance, modelSettings: { ...importedModel, defaultVersion: modelDefaultVersion } };
          const imported = await fetch("/api/workspace/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 0, state: legacyState, preferences }) });
          if (imported.status === 409) {
            remote = (await imported.json() as { current: WorkspaceStateResponse }).current;
          } else {
            if (!imported.ok) throw new Error(await responseError(imported, "Your existing workspace could not be imported."));
            remote = { ...(await imported.json() as WorkspaceStateResponse), exists: true };
          }
        }
        if (cancelled) return;
        const failureId = applyRemote(remote);
        if (failureId) setMigratedFailureId(failureId);
        localStorage.removeItem(storageKey);
        localStorage.removeItem("wdyt-appearance");
        localStorage.removeItem("decision-feed-model-v1");
      } catch (error) {
        if (cancelled) return;
        console.error(error instanceof Error ? error.message : "Your saved workspace could not be loaded.");
      } finally {
        if (!cancelled) { setModelSettingsLoaded(true); setReady(true); }
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [storageKey, previewMode]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = appearance === "system" ? (media.matches ? "dark" : "light") : appearance;
      document.documentElement.dataset.appearance = resolved;
      document.documentElement.style.colorScheme = resolved;
      // Hydration starts with a temporary "system" value. Only send the saved
      // preference once it is loaded, so native launch UI keeps its last theme.
      postNativeMessage({ version: 1, action: "appearanceState", payload: { appearance: resolved, ...(hasRemoteState ? { preference: appearance } : {}) } });
    };
    apply();
    if (appearance === "system") media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance, hasRemoteState]);

  useEffect(() => {
    if (!ready) return;
    const removeExpired = () => setDecisions((items) => {
      const current = items.filter((decision) => decisionIsCurrent(decision));
      return current.length === items.length ? items : current;
    });
    removeExpired();
    const timer = window.setInterval(removeExpired, 60_000);
    return () => window.clearInterval(timer);
  }, [ready]);

  // Results left on decisions (by older clients or a finished run) belong in history.
  useEffect(() => {
    if (!ready) return;
    const withResults = decisions.filter((decision) => decision.result);
    if (!withResults.length) return;
    const ids = new Set(withResults.map((decision) => decision.id));
    const entries = withResults.map((decision) => decisionResultFailed(decision) ? failedHistoryFromDecision(decision) : completedHistoryFromDecision(decision));
    setDecisions((items) => items.filter((decision) => !ids.has(decision.id)));
    setHistory((items) => [...entries, ...items.filter((entry) => !entries.some((fresh) => fresh.id === entry.id))]);
  }, [ready, decisions]);

  useEffect(() => {
    if (!ready || previewMode) return;
    const missing = history.filter((entry) => !historyCompletedAt(entry) && (entry.runId || entry.decisionId) && !dateHydrationRef.current.has(entry.id));
    if (!missing.length) return;
    missing.forEach((entry) => dateHydrationRef.current.add(entry.id));
    void Promise.all(missing.map(async (entry) => {
      const endpoint = entry.runId ? `/api/runs/${encodeURIComponent(entry.runId)}` : `/api/runs?decisionId=${encodeURIComponent(entry.decisionId!)}`;
      const response = await fetch(endpoint, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return null;
      const snapshot = await response.json() as AgentRunSnapshot;
      return { id: entry.id, completedAt: snapshot.completedAt ?? snapshot.updatedAt ?? snapshot.createdAt };
    })).then((resolved) => {
      const dates = new Map(resolved.filter((item): item is { id: string; completedAt: string } => Boolean(item?.completedAt)).map((item) => [item.id, item.completedAt]));
      if (!dates.size) return;
      setHistory((items) => items.map((entry) => { const completedAt = dates.get(entry.id); return completedAt ? { ...entry, completedAt, time: displayTime(completedAt) } : entry; }));
    });
  }, [history, previewMode, ready]);

  useEffect(() => {
    if (previewMode || !ready || !modelSettingsLoaded) return;
    const state: WorkspaceStateData = { decisions, tasks, history, discardedDecisionIds };
    const { preferences, serialized } = serialize(state, appearance, modelSettings);
    if (serialized === lastPersistedRef.current) return;
    const timer = window.setTimeout(() => {
      if (deletionRef.current) return;
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        if (deletionRef.current) return;
        let stateToSave = state;
        let response = await fetch("/api/workspace/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: versionRef.current, state: stateToSave, preferences }) });
        if (response.status === 409) {
          const conflict = await response.json() as { current: WorkspaceStateResponse };
          stateToSave = mergeWorkspaceState(state, conflict.current.state);
          response = await fetch("/api/workspace/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: conflict.current.version, state: stateToSave, preferences }) });
        }
        if (!response.ok) throw new Error(await responseError(response, "Your changes could not be saved."));
        const saved = await response.json() as WorkspaceStateResponse;
        versionRef.current = saved.version;
        lastPersistedRef.current = JSON.stringify({ state: stateToSave, preferences });
        if (stateToSave !== state) {
          setDecisions(stateToSave.decisions);
          setTasks(stateToSave.tasks);
          setHistory(stateToSave.history);
          setDiscardedDecisionIds(stateToSave.discardedDecisionIds);
        }
      }).catch((error) => console.error(error instanceof Error ? error.message : "Your changes could not be saved."));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [decisions, tasks, history, discardedDecisionIds, appearance, modelSettings, modelSettingsLoaded, ready, saveRetry, previewMode]);

  useEffect(() => {
    if (!ready || !modelSettingsLoaded || previewMode) return;
    const syncFromDatabase = async () => {
      if (deletionRef.current) return;
      if (serialize({ decisions, tasks, history, discardedDecisionIds }, appearance, modelSettings).serialized !== lastPersistedRef.current) { setSaveRetry((value) => value + 1); return; }
      const response = await fetch("/api/workspace/state", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const remote = await response.json() as WorkspaceStateResponse;
      if (remote.version <= versionRef.current) return;
      applyRemote(remote);
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void syncFromDatabase(); };
    window.addEventListener("focus", syncFromDatabase);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void syncFromDatabase(); }, 15_000);
    return () => { window.removeEventListener("focus", syncFromDatabase); document.removeEventListener("visibilitychange", onVisibility); window.clearInterval(timer); };
  }, [decisions, tasks, history, discardedDecisionIds, appearance, modelSettings, modelSettingsLoaded, ready, previewMode]);

  useEffect(() => {
    const retry = () => setSaveRetry((value) => value + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  /** After a server-side wipe: drop everything locally and remember that empty state as persisted. */
  const clearAll = () => {
    setDecisions([]); setTasks([]); setHistory([]); setDiscardedDecisionIds([]);
    setAppearance("system"); setModelSettings(defaultModelSettings);
    versionRef.current = 0;
    lastPersistedRef.current = serialize(EMPTY_STATE, "system", defaultModelSettings).serialized;
    localStorage.removeItem(storageKey);
    localStorage.removeItem("wdyt-appearance");
    localStorage.removeItem("decision-feed-model-v1");
  };

  return {
    decisions, tasks, history, discardedDecisionIds, appearance, modelSettings, ready, hasRemoteState, migratedFailureId,
    setDecisions, setTasks, setHistory, setDiscardedDecisionIds, setAppearance, setModelSettings,
    saveQueueRef, deletionRef, clearAll, refresh,
  };
}
