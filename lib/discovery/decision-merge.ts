import type { Decision } from "../types";

export function sameDiscoveryIncident(left: Decision, right: Decision) {
  if (left.id === right.id) return true;
  return Boolean(
    left.discoveryFingerprint
    && right.discoveryFingerprint
    && left.discoveryFingerprint === right.discoveryFingerprint
  );
}

function conversationKey(decision: Decision) {
  const source = decision.executionContext?.sourceEmail;
  return source?.threadId
    ? `${decision.executionContext?.sourceAccountId ?? "primary"}:gmail:${source.threadId}`
    : null;
}

/**
 * An explicit semantic update can cross Gmail threads while retaining the
 * original conversation. Otherwise require both thread and incident continuity;
 * a genuinely new incident in the same thread remains a separate suggestion.
 */
export function reconcileDiscoveredConversations(current: Decision[], discovered: Decision[]) {
  const discoveredByConversation = new Map<string, Decision[]>();
  for (const decision of discovered) {
    const key = conversationKey(decision);
    if (!key) continue;
    discoveredByConversation.set(key, [...(discoveredByConversation.get(key) ?? []), decision]);
  }

  const matchedDiscoveredIds = new Set<string>();
  const updatedDecisions: Decision[] = [];
  const sameAccount = (left: Decision, right: Decision) =>
    (left.executionContext?.sourceAccountId ?? "primary") === (right.executionContext?.sourceAccountId ?? "primary");
  const newestFirst = [...discovered].sort((a, b) =>
    (Date.parse(b.executionContext?.sourceEmail?.date ?? "") || 0) - (Date.parse(a.executionContext?.sourceEmail?.date ?? "") || 0));
  const refreshedCurrent = current.map((existing) => {
    const key = conversationKey(existing);
    const explicitUpdate = newestFirst.find((candidate) => candidate.discoveryUpdatesDecisionId === existing.id
      && !matchedDiscoveredIds.has(candidate.id) && sameAccount(existing, candidate));
    const replacement = explicitUpdate ?? (key
      ? discoveredByConversation.get(key)?.find((candidate) => (
        !candidate.discoveryUpdatesDecisionId && !matchedDiscoveredIds.has(candidate.id)
        && sameDiscoveryIncident(existing, candidate)
      ))
      : undefined);
    if (!replacement) return existing;
    matchedDiscoveredIds.add(replacement.id);
    const source = replacement.executionContext?.sourceEmail;
    const previousSource = existing.executionContext?.sourceEmail;
    // Replaying a processed reply must not re-alert or roll a newer proposal back.
    if (explicitUpdate && (!source || source.messageId === previousSource?.messageId
      || (previousSource && Date.parse(source.date) < Date.parse(previousSource.date)))) return existing;
    const refreshed = { ...replacement, id: existing.id, createdAt: existing.createdAt,
      discoveryFingerprint: existing.discoveryFingerprint ?? replacement.discoveryFingerprint,
      discoveryUpdatesDecisionId: undefined,
      discoveryUpdateKey: explicitUpdate ? source!.messageId : existing.discoveryUpdateKey };
    if (explicitUpdate) updatedDecisions.push(refreshed);
    return refreshed;
  });

  return {
    refreshedCurrent,
    updatedDecisions,
    unmatchedDiscovered: discovered.filter((decision) => !decision.discoveryUpdatesDecisionId && !matchedDiscoveredIds.has(decision.id)),
  };
}
