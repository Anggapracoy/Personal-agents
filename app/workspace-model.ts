import { currentAppleConnections } from "./apple-connection-context";
import { appleOperationIsRead } from "../lib/apple/catalog";
import { encodeChatFiles } from "./chat-files";
import { conversationWorkLabel, conversationWorkActivity, conversationActivityAt } from "../lib/harness/thread";
import type { Category, Decision, DecisionOption, HistoryEntry, RunningTask, WorkspacePreferences, WorkspaceReasoningEffort, WorkspaceStateData } from "../lib/types";
import type { AgentRunSnapshot } from "../lib/harness/types";
import type { AgentQuestion } from "../lib/harness/questions";
import { sameDiscoveryIncident, reconcileDiscoveredConversations } from "../lib/discovery/decision-merge";
import { existingDecisionContextFromWorkspace } from "../lib/discovery/existing-decisions";
import { browserTimeZone, responseError } from "./native-bridge";

type ReasoningEffort = WorkspaceReasoningEffort;
export type ModelSettings = { provider: "anthropic" | "openai" | "meta"; modelId: string; reasoningEffort: ReasoningEffort };
export type StoredModelSettings = Partial<ModelSettings> & { defaultVersion?: number };
export type WorkspaceStateResponse = {
  exists?: boolean;
  state: WorkspaceStateData;
  preferences: WorkspacePreferences;
  version: number;
  updatedAt: string | null;
};
export type GoogleConnection = { id: string; email: string; name: string; enabled: boolean; connectedAt: string; needsReconnect?: boolean };
export type LifeProfile = {
  homeCity: string | null;
  homeCountry: string | null;
  travelMode: string | null;
  travelBufferMinutes: number | null;
  goals: string[];
  customGoal: string | null;
  customInstructions?: string;
  profileVersion: number;
};
export type LifeFact = {
  id: string;
  kind: string;
  value: Record<string, unknown>;
  source: string;
  confidence: number;
  lastConfirmedAt: string | null;
};
export type LifeProfileResponse = { profile: LifeProfile | null; facts: LifeFact[]; requiredVersion: number };
export type LifeProfileDraft = { homeCity: string; travelMode: string; travelBufferMinutes: number | null; goals: string[]; customGoal: string; customInstructions: string };
export type SharedIntakeDetail = { requestId?: string; text?: string; url?: string; sourceApp?: string; files?: Array<{ name: string; mimeType: string; size: number; dataBase64: string }> };
export type DeviceCalendarSnapshot = { status: "authorized" | "notDetermined" | "denied" | "writeOnly" | "unavailable"; events: Array<Record<string, unknown>> };
export type CalendarDayEvent = {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  attendees: string[];
  htmlLink: string;
  sourceKind: "google" | "device";
  sourceLabel?: string;
  proposed?: boolean;
};
export type ModelOption = Pick<ModelSettings, "provider" | "modelId"> & { name: string; description: string };

export const modelOptions: ModelOption[] = [
  { provider: "meta", modelId: "muse-spark-1.3", name: "Muse Spark 1.3", description: "Long-running agent work with efficient tool use" },
  { provider: "openai", modelId: "gpt-5.6-sol", name: "GPT-5.6 Sol", description: "Deep reasoning and complex agent work" },
  { provider: "openai", modelId: "gpt-5.6-terra", name: "GPT-5.6 Terra", description: "Balanced intelligence, speed, and cost" },
  { provider: "openai", modelId: "gpt-5.6-luna", name: "GPT-5.6 Luna", description: "Fast, cost-sensitive workloads" },
  { provider: "anthropic", modelId: "claude-fable-5", name: "Fable 5", description: "Long-running agents and deep reasoning" },
  { provider: "anthropic", modelId: "claude-opus-5", name: "Opus 5", description: "Complex agentic and enterprise work" },
  { provider: "anthropic", modelId: "claude-sonnet-5", name: "Sonnet 5", description: "Strong speed and intelligence balance" },
  { provider: "anthropic", modelId: "claude-haiku-4-5-20251001", name: "Haiku 4.5", description: "Fast, economical reasoning" },
];

export const defaultModelSettings: ModelSettings = { provider: "meta", modelId: "muse-spark-1.3", reasoningEffort: "medium" };
export const modelDefaultVersion = 3;

export function lifeLabel(value: string) {
  return value === "life_admin" ? "Life admin" : value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function lifeFactSummary(fact: LifeFact) {
  if (fact.kind === "home_base") return [fact.value.city, fact.value.country].filter(Boolean).join(", ");
  if (fact.kind === "travel_preference") return [fact.value.mode && lifeLabel(String(fact.value.mode)), fact.value.bufferMinutes && `${fact.value.bufferMinutes} min buffer`].filter(Boolean).join(" · ");
  if (fact.kind === "goals") {
    const areas = Array.isArray(fact.value.areas) ? fact.value.areas.map((area) => lifeLabel(String(area))).join(", ") : "";
    return [areas, fact.value.customGoal].filter(Boolean).join(" · ");
  }
  return Object.entries(fact.value)
    .filter(([key, value]) => key !== "userPreference" && (typeof value === "string" || typeof value === "number"))
    .map(([, value]) => value)
    .join(" · ");
}

export function lifeProfileDraft(profile: LifeProfile | null): LifeProfileDraft {
  return {
    homeCity: profile?.homeCity ?? "",
    travelMode: profile?.travelMode ?? "",
    travelBufferMinutes: profile?.travelBufferMinutes ?? null,
    goals: profile?.goals ?? [],
    customGoal: profile?.customGoal ?? "",
    customInstructions: profile?.customInstructions ?? "",
  };
}

function reasoningEffort(value: unknown): ReasoningEffort {
  return value === "medium" || value === "high" || value === "xhigh" ? value : "low";
}

const categoryLabels: Record<Category, string> = {
  schedule: "Schedule",
  money: "Money",
  food: "Food",
  family: "Family",
  shopping: "Shopping",
  travel: "Travel",
  social: "Plans",
};

export function displayTime(timestamp = new Date().toISOString()) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

export function historyCompletedAt(entry: HistoryEntry) {
  if (entry.completedAt && Number.isFinite(Date.parse(entry.completedAt))) return entry.completedAt;
  const legacyTimestamp = entry.id.match(/-(\d{13})$/)?.[1];
  if (!legacyTimestamp) return null;
  const timestamp = Number(legacyTimestamp);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}


export function decisionIsCurrent(decision: Decision, now = Date.now()) {
  if (decision.activeRunId || decision.result || !decision.actionableUntil) return true;
  const actionableUntil = Date.parse(decision.actionableUntil);
  return Number.isFinite(actionableUntil) && actionableUntil > now;
}

export type GoogleScanResult = { decisions: Decision[]; warnings?: string[]; scannedEmailCount?: number; analyzedEmailCount?: number; decisionEmailCount?: number; scannedCalendarEventCount?: number; calendarConflictCount?: number };
export type ManualScanJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: { decisionCount?: number; warnings?: string[] } | null;
  error?: string | null;
};

export async function readGoogleScan(response: Response, onDecision: (decision: Decision) => void, onStatus?: (message: string) => void): Promise<GoogleScanResult> {
  if (!response.ok) throw new Error(await responseError(response, "Inbox and calendar scan failed"));
  if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body) return response.json() as Promise<GoogleScanResult>;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: GoogleScanResult | null = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ({ type: "decision"; decision: Decision } | ({ type: "complete" } & GoogleScanResult) | { type: "error"; error?: string } | { type: "status"; message: string });
      if (event.type === "decision") onDecision(event.decision);
      else if (event.type === "complete") completed = event;
      else if (event.type === "error") throw new Error(event.error || "Inbox and calendar scan failed");
      else if (event.type === "status") onStatus?.(event.message);
    }
    if (done) break;
  }
  if (!completed) throw new Error("Inbox scan ended before completion");
  return completed;
}

export function historyFromDecision(decision: Decision, chosenOption: string, status: HistoryEntry["status"] = "done"): HistoryEntry {
  const completedAt = new Date().toISOString();
  return {
    id: `history-${decision.id}-${Date.now()}`,
    decisionId: decision.id,
    category: decision.category,
    title: decision.title.replace(/\?$/, ""),
    subtitle: status === "dismissed" ? "You decided not to act" : `You chose: ${chosenOption}`,
    time: displayTime(completedAt),
    completedAt,
    group: "TODAY",
    status,
    originalContext: decision.originalContext,
    contextSummary: decision.whyThisAppeared?.[0] ?? decision.subtitle,
    chosenOption,
    steps: status === "dismissed" ? [] : ["Recorded your choice", "Completed the requested update"],
    outcome: status === "dismissed" ? "" : "Your choice was handled successfully.",
    ...(status === "dismissed" ? { responseDisposition: "reaction" as const, choiceAcknowledgment: "👍" as const } : {}),
    retryDecision: retryableDecision(decision),
  };
}

const LEGACY_NO_AGENT_OPTION = /\b(?:take no action|do nothing|allow (?:it|this|the [^.!?]+) to be (?:deleted|removed|cancelled|canceled|closed|expired)|let (?:it|this|the [^.!?]+) (?:expire|be deleted|be removed)|keep (?:it|the (?:current )?(?:booking|plan|subscription)) unchanged|keep (?:it|the (?:current )?(?:booking|plan|subscription)))\b/i;

export function optionNeedsNoAgent(option: DecisionOption) {
  if (option.actionType === "no_action") return true;
  return option.actionType === "instant" && LEGACY_NO_AGENT_OPTION.test(`${option.label}\n${option.sublabel ?? ""}`);
}

/** Declining any proactive offer archives it, regardless of origin or wording. */
export function shouldArchiveNoActionChoice(decision: Decision, option: DecisionOption) {
  return decision.sourceType !== "manual" && optionNeedsNoAgent(option);
}

/** A lack of external mutation is valid for drafts, explanations, or changed requests. */
export function decisionResultFailed(decision: Decision) {
  return decision.result?.outcome === "needs_user";
}

function retryableDecision(decision: Decision): Decision {
  const { result: _result, runArtifacts: _artifacts, activeRunId: _runId, selectedOption: _choice, ...retry } = decision;
  return retry;
}

export function failedHistoryFromDecision(decision: Decision, failure?: { runId?: string; summary?: string; details?: string; result?: Decision["result"]; completedAt?: string | null }): HistoryEntry {
  const result = failure?.result ?? decision.result;
  const completedAt = failure?.completedAt ?? new Date().toISOString();
  return {
    id: `failed-${decision.id}`,
    runId: failure?.runId ?? decision.activeRunId,
    decisionId: decision.id,
    category: decision.category,
    title: decision.title.replace(/\?$/, ""),
    subtitle: failure?.summary ?? result?.summary ?? "Dash couldn’t finish this task",
    time: displayTime(completedAt),
    completedAt,
    group: "TODAY",
    status: "failed",
    originalContext: decision.originalContext,
    contextSummary: decision.whyThisAppeared?.[0] ?? decision.subtitle,
    chosenOption: decision.selectedOption ?? "Agent task",
    steps: [],
    outcome: failure?.details ?? result?.details ?? "The run stopped without completing the requested outcome.",
    result,
    artifacts: decision.runArtifacts,
    retryDecision: retryableDecision(decision),
  };
}

export function completedHistoryFromDecision(decision: Decision, snapshot?: AgentRunSnapshot): HistoryEntry {
  const result = snapshot?.result ?? decision.result;
  const runId = snapshot?.id ?? decision.activeRunId;
  const moneySaved = result?.moneySaved ?? undefined;
  const completedAt = snapshot?.completedAt ?? snapshot?.updatedAt ?? new Date().toISOString();
  return {
    id: runId ? `completed-${runId}` : `result-${decision.id}`,
    activityAt: snapshot ? conversationActivityAt(snapshot) : undefined,
    runId,
    decisionId: decision.id,
    category: decision.category,
    title: decision.title.replace(/\?$/, ""),
    subtitle: result?.summary ?? "Task completed",
    time: displayTime(completedAt),
    completedAt,
    group: "TODAY",
    status: moneySaved ? "saved" : "done",
    originalContext: decision.originalContext,
    contextSummary: decision.whyThisAppeared?.[0] ?? decision.subtitle,
    chosenOption: snapshot?.metadata.initialReaction ? "" : decision.selectedOption ?? "Completed",
    steps: [],
    outcome: result?.details ?? snapshot?.response ?? "The requested task was completed.",
    moneySaved,
    artifacts: decision.runArtifacts,
    result,
    retryDecision: retryableDecision(decision),
  };
}

export function completedHistoryFromTask(task: RunningTask): HistoryEntry {
  const completedAt = new Date().toISOString();
  return {
    id: `completed-${task.runId ?? task.id}`,
    activityAt: task.activityAt,
    runId: task.runId,
    decisionId: task.decisionId,
    category: task.category,
    title: task.title.replace(/\?$/, ""),
    subtitle: "Marked as done by you",
    time: displayTime(completedAt),
    completedAt,
    group: "TODAY",
    status: "done",
    originalContext: task.originalContext,
    contextSummary: task.subtitle,
    chosenOption: task.chosenOption,
    steps: [],
    outcome: "You marked this task as done.",
    retryDecision: task.retryDecision,
  };
}

export function restorableDecisionFromHistory(entry: HistoryEntry): Decision {
  if (entry.retryDecision) return retryableDecision(entry.retryDecision);
  const chosenOption = entry.chosenOption && entry.chosenOption !== "Completed" ? entry.chosenOption : "Handle this task";
  return {
    id: entry.decisionId ?? `restored-${entry.id}`,
    sourceType: "manual",
    category: entry.category,
    urgency: "medium",
    title: entry.title,
    subtitle: entry.contextSummary ?? entry.subtitle,
    originalContext: entry.originalContext ?? entry.outcome,
    executionContext: {},
    options: [{ id: "restored-action", label: chosenOption, sublabel: "Run this task again", actionType: "approval", isPrimary: true }],
    dismissLabel: "Not now",
    createdAt: new Date().toISOString(),
  };
}

export function failedHistoryFromTask(task: RunningTask, details: string, result?: Decision["result"], occurredAt?: string | null): HistoryEntry {
  const completedAt = occurredAt ?? new Date().toISOString();
  const retryDecision: Decision = task.retryDecision ?? {
    id: task.decisionId,
    sourceType: "manual",
    category: task.category,
    urgency: "medium",
    title: task.title,
    subtitle: "Failed agent task - ready to return to your Feed",
    originalContext: task.originalContext,
    executionContext: {},
    options: [{ id: "rerun-manual", label: "Run task", sublabel: "Start this agent task again", actionType: "approval", isPrimary: true }],
    dismissLabel: "Not now",
    createdAt: new Date().toISOString(),
  };
  return {
    id: `failed-${task.decisionId}`,
    runId: task.runId,
    decisionId: task.decisionId,
    category: task.category,
    title: task.title,
    subtitle: result?.summary ?? "Dash couldn’t finish this task",
    time: displayTime(completedAt),
    completedAt,
    group: "TODAY",
    status: "failed",
    originalContext: task.originalContext,
    contextSummary: task.subtitle,
    chosenOption: task.chosenOption,
    steps: [],
    outcome: details,
    result,
    retryDecision,
  };
}

export function normalizedWorkspaceState(state: WorkspaceStateData) {
  const failedRunIds = new Set(state.tasks.filter((task) => task.status === "failed").flatMap((task) => task.runId ? [task.runId] : []));
  const normalizedDecisions = state.decisions.map((decision) => decision.activeRunId && failedRunIds.has(decision.activeRunId)
    ? { ...decision, activeRunId: undefined, selectedOption: undefined }
    : decision);
  const failedResults = normalizedDecisions.filter(decisionResultFailed);
  const migratedFailures = failedResults.map((decision) => failedHistoryFromDecision(decision));
  const migratedIds = new Set(migratedFailures.map((entry) => entry.id));
  return {
    state: {
      decisions: normalizedDecisions.filter((decision) => decisionIsCurrent(decision) && !decisionResultFailed(decision)),
      tasks: state.tasks.filter((task) => task.status !== "failed"),
      history: [...migratedFailures, ...state.history.filter((entry) => !migratedIds.has(entry.id))],
      discardedDecisionIds: state.discardedDecisionIds.filter((id): id is string => typeof id === "string"),
    } satisfies WorkspaceStateData,
    migratedFailureId: migratedFailures[0]?.id ?? null,
  };
}

export function mergeWorkspaceState(local: WorkspaceStateData, remote: WorkspaceStateData): WorkspaceStateData {
  const discardedDecisionIds = [...new Set([...local.discardedDecisionIds, ...remote.discardedDecisionIds])];
  const discarded = new Set(discardedDecisionIds);
  const remoteDecisions = remote.decisions.filter((decision) => !discarded.has(decision.id));
  const remoteDecisionIds = new Set(remoteDecisions.map((decision) => decision.id));
  const remoteFingerprints = new Set(remoteDecisions.flatMap((decision) => decision.discoveryFingerprint ? [decision.discoveryFingerprint] : []));
  const decisions = [
    ...remoteDecisions,
    ...local.decisions.filter((decision) => (
      !discarded.has(decision.id)
      && !remoteDecisionIds.has(decision.id)
      && (!decision.discoveryFingerprint || !remoteFingerprints.has(decision.discoveryFingerprint))
    )),
  ];
  const localTaskIds = new Set(local.tasks.map((task) => task.id));
  const localHistoryIds = new Set(local.history.map((entry) => entry.id));
  return {
    decisions,
    tasks: [...local.tasks, ...remote.tasks.filter((task) => !localTaskIds.has(task.id))],
    history: [...local.history, ...remote.history.filter((entry) => !localHistoryIds.has(entry.id))],
    discardedDecisionIds,
  };
}

export function supportedModelSettings(parsed: StoredModelSettings): ModelSettings | null {
  if ((parsed.provider !== "anthropic" && parsed.provider !== "openai" && parsed.provider !== "meta") || typeof parsed.modelId !== "string" || !parsed.modelId.trim()) return null;
  if (parsed.defaultVersion !== modelDefaultVersion && parsed.provider === "openai" && ["gpt-5.6-terra", "gpt-5.6-luna"].includes(parsed.modelId)) return { ...defaultModelSettings };
  const migratedModelId = parsed.modelId === "claude-sonnet-4-5"
    ? "claude-sonnet-5"
    : parsed.modelId === "gpt-5.6" ? "gpt-5.6-sol"
      : parsed.modelId === "claude-haiku-4-5" ? "claude-haiku-4-5-20251001"
        : parsed.modelId.trim();
  const option = modelOptions.find((model) => model.provider === parsed.provider && model.modelId === migratedModelId);
  return option ? { provider: option.provider, modelId: option.modelId, reasoningEffort: reasoningEffort(parsed.reasoningEffort) } : null;
}

export function scanContext(decisions: Decision[], tasks: RunningTask[], history: HistoryEntry[], discardedDecisionIds: string[] = []) {
  return existingDecisionContextFromWorkspace({ decisions, tasks, history, discardedDecisionIds });
}

export function mergeScannedDecisions(current: Decision[], scanned: Decision[], discardedDecisionIds: string[] = []) {
  const discarded = new Set(discardedDecisionIds);
  const allowed = scanned.filter((decision) => !discarded.has(decision.id) && decisionIsCurrent(decision));
  const { refreshedCurrent, unmatchedDiscovered } = reconcileDiscoveredConversations(
    current.filter(decisionIsCurrent),
    allowed.filter((decision) => !decision.discoveryUpdatesDecisionId || !discarded.has(decision.discoveryUpdatesDecisionId)),
  );
  return [...unmatchedDiscovered, ...refreshedCurrent.filter((item) => (
    !unmatchedDiscovered.some((fresh) => sameDiscoveryIncident(fresh, item))
  ))];
}

function questionsFromAction(input: Record<string, unknown>): AgentQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const question = candidate as Record<string, unknown>;
    const answerType = question.answerType;
    if (typeof question.id !== "string" || typeof question.question !== "string" || !["single_choice", "multiple_choice", "text", "secret"].includes(String(answerType))) return [];
    const options = Array.isArray(question.options) ? question.options.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const option = item as Record<string, unknown>;
      if (typeof option.id !== "string" || typeof option.label !== "string") return [];
      return [{ id: option.id, label: option.label, description: typeof option.description === "string" ? option.description : "" }];
    }) : [];
    return [{
      id: question.id,
      question: question.question,
      answerType: answerType as AgentQuestion["answerType"],
      options,
      placeholder: typeof question.placeholder === "string" ? question.placeholder : "",
    }];
  });
}

/** List row IDs change with status; all aliases still identify the same run. */
export function runRouteMatches(routeId: string, runId?: string | null) {
  return Boolean(runId && (routeId === runId || ['remote', 'completed', 'failed'].some(prefix => routeId === `${prefix}-${runId}`)));
}

export function taskFromRun(snapshot: AgentRunSnapshot): RunningTask {
  const pauseTools = new Set(["connector_request_connection", "apple_device", "ask_questions", "browser_request_takeover", "browser_request_signin", "google_request_reconnect", "vault_request_item", "vault_fill_login", "vault_fill_payment"]);
  const pendingAction = [...snapshot.actions].reverse().find((action) =>
    (action.status === "proposed" && (action.risk === "write_external" || pauseTools.has(action.toolName)))
    || (action.toolName === "apple_device" && action.status === "approved"));
  // Polling can observe the action completing before the run resumes.
  // An approval status alone must never manufacture a generic approval card.
  const waitingForDevice = snapshot.status === "awaiting_approval" && pendingAction?.toolName === "apple_device";
  const waitingForAction = snapshot.status === "awaiting_approval" && Boolean(pendingAction) && !waitingForDevice;
  const automaticPause = snapshot.status === "paused" ? snapshot.metadata.automaticPause as import("../lib/pauses/definition").PauseDisplay | undefined : undefined;
  const waitingForQuestions = snapshot.status === "paused" && pendingAction?.toolName === "ask_questions";
  const sensitiveApprovalKind = ["gmail_send_draft", "icloud_send_email"].includes(pendingAction?.toolName ?? "")
    ? "email_send" as const
    : pendingAction?.input.approvalCategory === "purchase" || ["purchase", "bill_payment", "transfer", "payment"].includes(String(pendingAction?.input.approvalType ?? ""))
      ? "purchase" as const
      : null;
  const browserUsed = typeof snapshot.metadata.browserUsed === "boolean" ? snapshot.metadata.browserUsed : snapshot.actions.some((action) => action.toolName.startsWith("browser_") && action.status !== "failed");
  const browserFrames = snapshot.actions.flatMap((action) => {
    if (!action.toolName.startsWith("browser_") || action.status !== "executed") return [];
    const artifact = snapshot.artifacts.find((candidate) => candidate.actionId === action.id && candidate.mimeType === "image/png");
    if (!artifact) return [];
    const resultLabel = typeof action.result?.browserFrameLabel === "string" ? action.result.browserFrameLabel : "";
    return [{ id: artifact.id, actionId: action.id, url: typeof action.result?.url === "string" ? action.result.url : undefined, label: (resultLabel || action.preview.split("\n")[0] || "Browser action").slice(0, 120), createdAt: artifact.createdAt }];
  });
  // Progress pills use present-tense copy, never action previews or reply text.
  const progressSubtitle = conversationWorkLabel(snapshot) ?? (snapshot.metadata.replyTyping === true ? "Typing" : "");
  return {
    id: `remote-${snapshot.id}`,
    runId: snapshot.id,
    actionId: pendingAction?.id,
    nativeAction: pendingAction?.toolName === "apple_device" ? { readOnly: appleOperationIsRead(String(pendingAction.input.operation)), operation: String(pendingAction.input.operation), parameters: pendingAction.input.parameters as Record<string, unknown> ?? {} } : undefined,
    decisionId: snapshot.decisionId ?? snapshot.id,
    category: (snapshot.category in categoryLabels ? snapshot.category : "social") as Category,
    title: snapshot.title,
    automaticPause,
    activity: conversationWorkActivity(snapshot) ?? undefined,
    activityAt: conversationActivityAt(snapshot),
    subtitle: pendingAction?.toolName === "apple_device" ? "Waiting for your iPhone" : automaticPause ? automaticPause.reason : waitingForQuestions ? "The agent needs your answer to continue" : pendingAction?.toolName === "vault_fill_login" || pendingAction?.toolName === "vault_fill_payment" ? "Waiting for Face ID/password" : pendingAction?.toolName === "browser_request_signin" ? "Needs you to sign in" : waitingForAction ? "Waiting for you before an external change" : snapshot.status === "failed" ? snapshot.error ?? "The agent hit a problem" : progressSubtitle,
    status: automaticPause || waitingForDevice ? "waiting" : waitingForAction || waitingForQuestions ? "needs_approval" : snapshot.status === "failed" ? "failed" : "running",
    estimate: automaticPause || waitingForDevice ? "Waiting" : waitingForAction || waitingForQuestions ? "Ready now" : "Live",
    updatedAt: snapshot.updatedAt,
    draft: pendingAction?.preview ?? (snapshot.status === "failed" ? snapshot.error ?? "This run could not complete." : undefined),
    chosenOption: snapshot.metadata.initialReaction ? "" : String(snapshot.metadata.userMessage ?? snapshot.metadata.customInstruction ?? snapshot.metadata.chosenOption ?? snapshot.request),
    originalContext: String(snapshot.metadata.originalContext ?? snapshot.request),
    approvalKind: sensitiveApprovalKind ?? (pendingAction?.toolName === "connector_request_connection" ? "connector" : pendingAction?.toolName === "ask_questions" ? "questions" : pendingAction?.toolName === "browser_request_takeover" ? "takeover" : pendingAction?.toolName === "browser_request_signin" ? "signin" : pendingAction?.toolName === "google_request_reconnect" ? "reconnect" : pendingAction?.toolName === "vault_request_item" ? (pendingAction.input.kind === "payment_card" ? "vault_payment" : "vault_login") : pendingAction?.toolName === "vault_fill_payment" ? "vault_payment" : pendingAction?.toolName === "vault_fill_login" ? "vault_login" : "external"),
    approvalRequest: pendingAction?.toolName === "connector_request_connection" ? { toolkit: String(pendingAction.input.toolkit), appName: String(pendingAction.input.name), appLogo: typeof pendingAction.input.logo === "string" ? pendingAction.input.logo : undefined, reason: String(pendingAction.input.reason) } : sensitiveApprovalKind === "email_send" ? {
      to: Array.isArray(pendingAction?.input.to) ? pendingAction.input.to.filter((value): value is string => typeof value === "string") : [],
      subject: typeof pendingAction?.input.subject === "string" ? pendingAction.input.subject : undefined,
      body: typeof pendingAction?.input.body === "string" ? pendingAction.input.body : undefined,
    } : sensitiveApprovalKind === "purchase" ? {
      pageUrl: typeof pendingAction?.input.pageUrl === "string" ? pendingAction.input.pageUrl : undefined,
      purpose: typeof pendingAction?.input.purpose === "string" ? pendingAction.input.purpose : undefined,
      controlLabel: typeof pendingAction?.input.elementName === "string" ? pendingAction.input.elementName : undefined,
      approvalType: ["purchase", "bill_payment", "transfer", "payment"].includes(String(pendingAction?.input.approvalType ?? "")) ? pendingAction?.input.approvalType as "purchase" | "bill_payment" | "transfer" | "payment" : "purchase",
    } : pendingAction?.toolName === "browser_request_takeover" || pendingAction?.toolName === "browser_request_signin" ? {
      mode: pendingAction.input.mode === "wait_for_user" ? "wait_for_user" : "browser",
      pageUrl: typeof pendingAction.input.pageUrl === "string" ? pendingAction.input.pageUrl : undefined,
      reason: [pendingAction.input.reason, pendingAction.input.instructions].filter((value): value is string => typeof value === "string").join(" "),
    } : pendingAction?.toolName === "vault_request_item" ? {
      siteHost: typeof pendingAction.input.siteHost === "string" ? pendingAction.input.siteHost : undefined,
      suggestedLabel: typeof pendingAction.input.suggestedLabel === "string" ? pendingAction.input.suggestedLabel : undefined,
      reason: typeof pendingAction.input.reason === "string" ? pendingAction.input.reason : undefined,
      needSecurityCode: pendingAction.input.needSecurityCode === true,
      kind: pendingAction.input.kind === "payment_card" ? "payment_card" : "login",
    } : pendingAction?.toolName === "vault_fill_login" || pendingAction?.toolName === "vault_fill_payment" ? {
      deviceRelease: true,
      itemId: typeof pendingAction.input.itemId === "string" ? pendingAction.input.itemId : undefined,
      kind: pendingAction.toolName === "vault_fill_payment" ? "payment_card" : "login",
      recipientPublicKey: typeof pendingAction.input.recipientPublicKey === "string" ? pendingAction.input.recipientPublicKey : undefined,
      needSecurityCode: pendingAction.input.needSecurityCode === true,
      reason: pendingAction.preview,
    } : undefined,
    questionRequest: pendingAction?.toolName === "ask_questions" ? { questions: questionsFromAction(pendingAction.input) } : undefined,
    browserFrames,
    browserUsed,
    retryDecision: snapshot.metadata.retryDecision && typeof snapshot.metadata.retryDecision === "object"
      ? retryableDecision(snapshot.metadata.retryDecision as Decision)
      : undefined,
  };
}

export async function createHarnessRun(decision: Decision, option: DecisionOption, settings: ModelSettings, detail?: string, customInstruction?: string, overrides?: { title?: string; request?: string; metadata?: Record<string, unknown>; files?: File[] }) {
  const choice = option.label;
  const normalizedInstruction = customInstruction?.trim();
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: await encodeChatFiles(overrides?.files),
      appleConnections: await currentAppleConnections(),
      decisionId: decision.id,
      category: decision.category,
      title: overrides?.title ?? decision.title.replace(/\?$/, ""),
      request: overrides?.request ?? (normalizedInstruction
        ? `The user gave a custom instruction for this decision: ${decision.title}. Context: ${decision.subtitle}. Follow this instruction exactly: “${normalizedInstruction}” Execute it completely, prefer connected tools when appropriate, and verify the outcome.`
        : `The user chose “${choice}” for this decision: ${decision.title}. Context: ${decision.subtitle}. ${detail ?? "Execute the choice completely, prefer connected MCP tools, and verify the outcome."}`),
      modelProvider: settings.provider,
      modelId: settings.modelId,
      reasoningEffort: settings.reasoningEffort,
      metadata: { chosenOption: choice, actionType: option.actionType, customInstruction: normalizedInstruction, originalContext: decision.originalContext, sourceType: decision.sourceType, executionContext: decision.executionContext ?? {}, retryDecision: retryableDecision(decision), userTimeZone: browserTimeZone(), ...(overrides?.metadata ?? {}) },
    }),
  });
  if (!response.ok) throw new Error(await responseError(response, "Could not start agent run"));
  return response.json() as Promise<AgentRunSnapshot>;
}

function categoryFromRun(snapshot: AgentRunSnapshot): Category {
  return (snapshot.category in categoryLabels ? snapshot.category : "social") as Category;
}

/** History for a finished thread whose decision is no longer in the workspace (manual threads, revived threads). */
export function historyFromRun(snapshot: AgentRunSnapshot): HistoryEntry {
  const completedAt = snapshot.completedAt ?? snapshot.updatedAt;
  const quiet = snapshot.metadata.responseDisposition === "silent" || snapshot.metadata.responseDisposition === "reaction";
  const result = snapshot.result ?? undefined;
  const failed = snapshot.status === "failed" || result?.outcome === "needs_user";
  const moneySaved = result?.moneySaved ?? undefined;
  const retry = snapshot.metadata.retryDecision && typeof snapshot.metadata.retryDecision === "object" ? retryableDecision(snapshot.metadata.retryDecision as Decision) : undefined;
  return {
    id: failed ? `failed-${snapshot.id}` : `completed-${snapshot.id}`,
    activityAt: conversationActivityAt(snapshot),
    runId: snapshot.id,
    responseDisposition: quiet ? snapshot.metadata.responseDisposition as "silent" | "reaction" : "text",
    decisionId: snapshot.decisionId ?? undefined,
    category: categoryFromRun(snapshot),
    title: snapshot.title,
    subtitle: failed ? result?.summary ?? "Dash couldn’t finish this task" : result?.summary ?? (snapshot.response.trim() || (quiet ? "" : "Task completed")),
    time: displayTime(completedAt),
    completedAt,
    group: "TODAY",
    status: failed ? "failed" : moneySaved ? "saved" : "done",
    originalContext: String(snapshot.metadata.originalContext ?? snapshot.request),
    contextSummary: String(snapshot.metadata.userMessage ?? snapshot.request).slice(0, 160),
    chosenOption: snapshot.metadata.initialReaction ? "" : String(snapshot.metadata.userMessage ?? snapshot.metadata.chosenOption ?? "Manual task"),
    steps: [],
    outcome: failed ? snapshot.error ?? result?.details ?? "The run stopped without completing the requested outcome." : result?.details ?? snapshot.response ?? "Task completed.",
    moneySaved,
    result,
    artifacts: snapshot.artifacts.filter((artifact) => !artifact.name.startsWith("browser-frame-")).map((artifact) => ({ id: artifact.id, runId: snapshot.id, name: artifact.name, mimeType: artifact.mimeType })),
    retryDecision: retry,
  };
}

export function sortedHistory(history: HistoryEntry[]) {
  return [...history].sort((left, right) => {
    const leftTime = historyCompletedAt(left);
    const rightTime = historyCompletedAt(right);
    return (rightTime ? Date.parse(rightTime) : Number.NEGATIVE_INFINITY) - (leftTime ? Date.parse(leftTime) : Number.NEGATIVE_INFINITY);
  });
}

/* ---------- calendar day ---------- */

export function calendarDecisionDate(decision: Decision) {
  const eventStart = decision.executionContext?.sourceCalendar?.events
    .map((event) => event.start)
    .find((value) => Number.isFinite(Date.parse(value)));
  const candidate = eventStart ?? decision.actionableUntil;
  const parsed = candidate ? new Date(candidate) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function normalizeDeviceCalendarEvent(value: Record<string, unknown>): CalendarDayEvent | null {
  const startContainer = value.start && typeof value.start === "object" ? value.start as Record<string, unknown> : null;
  const endContainer = value.end && typeof value.end === "object" ? value.end as Record<string, unknown> : null;
  const start = typeof startContainer?.dateTime === "string" ? startContainer.dateTime : typeof startContainer?.date === "string" ? startContainer.date : "";
  const end = typeof endContainer?.dateTime === "string" ? endContainer.dateTime : typeof endContainer?.date === "string" ? endContainer.date : "";
  if (typeof value.id !== "string" || !start || !end) return null;
  return {
    id: value.id,
    summary: typeof value.summary === "string" ? value.summary : "Event",
    description: typeof value.description === "string" ? value.description : "",
    location: typeof value.location === "string" ? value.location : "",
    start,
    end,
    attendees: [],
    htmlLink: typeof value.htmlLink === "string" ? value.htmlLink : "",
    sourceKind: "device",
    sourceLabel: typeof value.calendar === "string" ? value.calendar : "Apple Calendar",
  };
}

export function calendarSourceEvents(decision: Decision): CalendarDayEvent[] {
  const source = decision.executionContext?.sourceCalendar;
  if (!source) return [];
  return source.events.map((event) => ({ ...event, sourceKind: source.sourceKind ?? "google", sourceLabel: decision.sourceLabel }));
}

export function proposedCalendarEvent(decision: Decision): CalendarDayEvent | null {
  if (decision.executionContext?.sourceCalendar?.events.length) return null;
  const primaryOption = decision.options.find((option) => option.isPrimary) ?? decision.options[0];
  const choice = primaryOption?.label.trim() ?? "";
  const schedulingCopy = `${decision.title} ${choice}`;
  if (!/\b(?:propose|schedule|create|send|add|book)\b/i.test(choice)
    || !/\b(?:call|calendar|invite|invitation|meeting|time)\b|\bpropose\b/i.test(schedulingCopy)) return null;
  const base = calendarDecisionDate(decision);
  if (!base) return null;
  const start = new Date(base);
  const explicitTime = choice.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (explicitTime) {
    const rawHour = Number(explicitTime[1]);
    const minute = Number(explicitTime[2] ?? 0);
    const hour = (rawHour % 12) + (explicitTime[3]?.toUpperCase() === "PM" ? 12 : 0);
    start.setHours(hour, minute, 0, 0);
  }
  const end = new Date(start.getTime() + 30 * 60_000);
  const summary = decision.title
    .replace(/^(?:choose|decide)\s+whether\s+to\s+/i, "")
    .replace(/^(?:propose|schedule|create|send|add|book)\s+/i, "")
    .replace(/^take\s+/i, "")
    .replace(/\?$/, "")
    .trim() || "Calendar invite";
  return { id: `proposed-${decision.id}`, summary, description: decision.subtitle, location: "", start: start.toISOString(), end: end.toISOString(), attendees: [], htmlLink: "", sourceKind: "device", sourceLabel: "Proposed invite", proposed: true };
}

export function eventOnDay(event: CalendarDayEvent, start: Date, end: Date) {
  const eventStart = Date.parse(event.start);
  const eventEnd = Date.parse(event.end);
  return Number.isFinite(eventStart) && Number.isFinite(eventEnd) && eventStart < end.getTime() && eventEnd > start.getTime();
}

export function calendarTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
