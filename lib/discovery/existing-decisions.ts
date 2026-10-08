import type { WorkspaceStateData } from "../types";

export type ExistingDecisionContext = {
  id: string;
  status: "feed" | "running" | "history" | "discarded";
  category?: string;
  title: string;
  subtitle?: string;
  optionLabels?: string[];
  selectedOutcome?: string;
  userChoice?: string;
  createdAt?: string;
  resolvedAt?: string;
  whyThisAppeared?: string[];
  contextSummary?: string;
  sourceAccountId?: string;
  sourceEmailIds?: string[];
  sourceThreadIds?: string[];
  sourceCalendarEventIds?: string[];
  fingerprint?: string;
  actionableUntil?: string;
};

function cleanStrings(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, maxLength)).slice(0, maxItems)
    : undefined;
}

export function sanitizeExistingDecisionContexts(value: unknown): ExistingDecisionContext[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.title !== "string") return [];
    const id = item.id.trim().slice(0, 300);
    const title = item.title.trim().slice(0, 180);
    if (!id || !title) return [];
    const suppliedStatus = item.status;
    const status: ExistingDecisionContext["status"] = suppliedStatus === "running" || suppliedStatus === "history" || suppliedStatus === "discarded" ? suppliedStatus : "feed";
    return [{
      id,
      status,
      category: typeof item.category === "string" ? item.category.trim().slice(0, 40) : undefined,
      title,
      subtitle: typeof item.subtitle === "string" ? item.subtitle.trim().slice(0, 500) : undefined,
      optionLabels: cleanStrings(item.optionLabels, 6, 180),
      userChoice: typeof item.userChoice === "string" ? item.userChoice.slice(0, 300) : undefined,
      createdAt: typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt.slice(0, 80) : undefined,
      resolvedAt: typeof item.resolvedAt === "string" && Number.isFinite(Date.parse(item.resolvedAt)) ? item.resolvedAt.slice(0, 80) : undefined,
      selectedOutcome: typeof item.selectedOutcome === "string" ? item.selectedOutcome.trim().slice(0, 300) : undefined,
      whyThisAppeared: cleanStrings(item.whyThisAppeared, 5, 500),
      contextSummary: typeof item.contextSummary === "string" ? item.contextSummary.trim().slice(0, 4_000) : undefined,
      ...(typeof item.sourceAccountId === "string" ? { sourceAccountId: item.sourceAccountId.slice(0, 300) } : {}),
      sourceEmailIds: cleanStrings(item.sourceEmailIds, 20, 300),
      sourceThreadIds: cleanStrings(item.sourceThreadIds, 20, 300),
      sourceCalendarEventIds: cleanStrings(item.sourceCalendarEventIds, 20, 300),
      fingerprint: typeof item.fingerprint === "string" ? item.fingerprint.trim().slice(0, 200) : undefined,
      actionableUntil: typeof item.actionableUntil === "string" ? item.actionableUntil.trim().slice(0, 80) : undefined,
    }];
  });
}

export function existingDecisionContextFromWorkspace(state: WorkspaceStateData, now = Date.now(), options: { includeExpired?: boolean } = {}): ExistingDecisionContext[] {
  const known = new Map<string, ExistingDecisionContext>();
  for (const decision of state.decisions) {
    if (!options.includeExpired && decision.actionableUntil && Number.isFinite(Date.parse(decision.actionableUntil)) && Date.parse(decision.actionableUntil) <= now) continue;
    known.set(decision.id, {
      id: decision.id,
      status: "feed",
      category: decision.category,
      title: decision.title,
      subtitle: decision.subtitle,
      optionLabels: decision.options.map((option) => option.label),
      selectedOutcome: decision.selectedOption,
      userChoice: decision.selectedOption,
      createdAt: decision.createdAt,
      whyThisAppeared: decision.whyThisAppeared,
      contextSummary: decision.originalContext,
      ...(decision.executionContext?.sourceAccountId ? { sourceAccountId: decision.executionContext.sourceAccountId } : {}),
      sourceEmailIds: decision.executionContext?.sourceEmail ? [decision.executionContext.sourceEmail.messageId] : undefined,
      sourceThreadIds: decision.executionContext?.sourceEmail ? [decision.executionContext.sourceEmail.threadId] : undefined,
      sourceCalendarEventIds: decision.executionContext?.sourceCalendar?.eventIds,
      fingerprint: decision.discoveryFingerprint,
      actionableUntil: decision.actionableUntil,
    });
  }
  for (const task of state.tasks) known.set(task.decisionId, {
    ...known.get(task.decisionId),
    id: task.decisionId,
    sourceAccountId: task.retryDecision?.executionContext?.sourceAccountId ?? known.get(task.decisionId)?.sourceAccountId,
    sourceEmailIds: task.retryDecision?.executionContext?.sourceEmail ? [task.retryDecision.executionContext.sourceEmail.messageId] : known.get(task.decisionId)?.sourceEmailIds,
    sourceThreadIds: task.retryDecision?.executionContext?.sourceEmail ? [task.retryDecision.executionContext.sourceEmail.threadId] : known.get(task.decisionId)?.sourceThreadIds,
    status: "running",
    category: task.category,
    title: task.title,
    subtitle: task.subtitle,
    selectedOutcome: task.chosenOption,
    userChoice: task.chosenOption,
    createdAt: task.retryDecision?.createdAt,
    contextSummary: task.originalContext,
  });
  for (const entry of state.history) {
    const legacyDecisionId = /^history-(.+)-\d+$/.exec(entry.id)?.[1];
    const decisionId = entry.decisionId ?? legacyDecisionId;
    if (!decisionId) continue;
    known.set(decisionId, {
      id: decisionId,
      status: "history",
      category: entry.category,
      title: entry.title,
      subtitle: entry.subtitle,
      selectedOutcome: entry.outcome,
      userChoice: entry.chosenOption,
      createdAt: entry.retryDecision?.createdAt,
      resolvedAt: entry.completedAt,
      // History retains the complete source explanation. Supplying a compacted
      // copy to discovery lets it identify the same occurrence before launching
      // another Gmail/browser investigation from a differently worded reminder.
      contextSummary: entry.originalContext,
      sourceAccountId: entry.retryDecision?.executionContext?.sourceAccountId,
      sourceEmailIds: entry.retryDecision?.executionContext?.sourceEmail
        ? [entry.retryDecision.executionContext.sourceEmail.messageId]
        : undefined,
      sourceThreadIds: entry.retryDecision?.executionContext?.sourceEmail
        ? [entry.retryDecision.executionContext.sourceEmail.threadId]
        : undefined,
      sourceCalendarEventIds: entry.retryDecision?.executionContext?.sourceCalendar?.eventIds,
      fingerprint: entry.retryDecision?.discoveryFingerprint,
      actionableUntil: entry.retryDecision?.actionableUntil,
    });
  }
  for (const id of state.discardedDecisionIds) if (!known.has(id)) known.set(id, { id, status: "discarded", title: "Discarded task" });
  return sanitizeExistingDecisionContexts([...known.values()]);
}

export function mergeExistingDecisionContexts(...groups: ExistingDecisionContext[][]) {
  const merged = new Map<string, ExistingDecisionContext>();
  for (const group of groups) for (const decision of group) {
    const current = merged.get(decision.id);
    merged.set(decision.id, current ? { ...current, ...decision } : decision);
  }
  return [...merged.values()];
}
