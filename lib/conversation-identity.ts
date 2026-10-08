import type { AgentRunSnapshot } from "./harness/types";
import type { Category, Decision } from "./types";

/** Apply cosmetic identity without copying stale execution/status fields from a naming response. */
export function withConversationIdentity<T extends { title: string; category: Category; retryDecision?: Decision }>(item: T, snapshot: Pick<AgentRunSnapshot, "title" | "category" | "metadata">): T {
  if (snapshot.metadata.conversationIdentityGenerated !== true
    || !["schedule", "money", "food", "family", "shopping", "travel", "social"].includes(snapshot.category)) return item;
  const identity = { title: snapshot.title, category: snapshot.category as Category };
  return { ...item, ...identity, ...(item.retryDecision ? { retryDecision: { ...item.retryDecision, ...identity } } : {}) };
}

/** Saved workspace rows are caches; durable run identity wins when reopening the app. */
export function reconcileConversationIdentities(state: import("./types").WorkspaceStateData, identities: Array<Pick<AgentRunSnapshot, "id" | "decisionId" | "title" | "category">>) {
  const byRun = new Map(identities.map(identity => [identity.id, identity]));
  const byDecision = new Map(identities.filter(identity => identity.decisionId).map(identity => [identity.decisionId, identity]));
  const apply = <T extends { title: string; category: Category; retryDecision?: Decision }>(item: T, runId?: string, decisionId?: string) => {
    const identity = runId ? byRun.get(runId) : decisionId ? byDecision.get(decisionId) : undefined;
    return identity ? withConversationIdentity(item, { ...identity, metadata: { conversationIdentityGenerated: true } }) : item;
  };
  return { ...state,
    decisions: state.decisions.map(item => apply(item, item.activeRunId, item.id)),
    tasks: state.tasks.map(item => apply(item, item.runId, item.decisionId)),
    history: state.history.map(item => apply(item, item.runId, item.decisionId)),
  };
}
