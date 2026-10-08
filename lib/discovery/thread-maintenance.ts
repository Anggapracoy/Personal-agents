import type { DiscoveryCandidate, DiscoveryInput } from './types';
import type { DiscoveryVerdict } from './schemas';

/** Changed tracked threads bypass intake; the existing investigator handles both
 * resolution and any genuinely new action in one pass. Never a second checker. */
export function threadMaintenanceCandidates(input: DiscoveryInput): DiscoveryCandidate[] {
  if (!input.maintainChangedThreads) return [];
  const byThread = new Map<string, typeof input.emails>();
  for (const email of input.emails) {
    if (!email.threadId || !input.existingDecisions.some(d => d.status === 'feed' && d.sourceThreadIds?.includes(email.threadId))) continue;
    byThread.set(email.threadId, [...(byThread.get(email.threadId) ?? []), email]);
  }
  return [...byThread].map(([thread, emails]) => ({
    id: `changed-thread-${thread}`, situationKey: `changed-thread:${thread}`, signalType: 'other',
    summary: 'An existing suggestion’s email thread changed. Resolve handled suggestions and consider any new action in this same investigation.',
    emailIds: emails.map(e => e.id), potentialValue: 80,
    triggerFacts: ['New messages arrived in a thread supporting a current suggestion.'],
    researchQuestions: ['Read the current thread once. Which existing suggestions are now demonstrably handled, and is there a genuinely new useful action?'],
  }));
}

/** Models may only close unstarted suggestions in the actual changed thread,
 * supported by a new source message. IDs alone are never deletion authority. */
export function validatedResolutions(input: DiscoveryInput, candidate: DiscoveryCandidate, verdict: DiscoveryVerdict) {
  if (!input.maintainChangedThreads) return [];
  return (verdict.resolvedDecisions ?? []).filter(resolution => {
    const target = input.existingDecisions.find(d => d.id === resolution.decisionId && d.status === 'feed');
    const source = input.emails.find(e => e.id === resolution.sourceMessageId && candidate.emailIds.includes(e.id));
    return target && source && target.sourceThreadIds?.includes(source.threadId)
      && !target.sourceEmailIds?.includes(source.id) && resolution.reason.trim();
  }).map(r => r.decisionId);
}
