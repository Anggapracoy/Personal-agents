import type { ExistingDecisionContext } from '../../discovery/existing-decisions';

/** A draft is not a reply and must never mask the last delivered message. */
export function latestDeliveredMessage<T extends { labels?: string[] }>(messages: T[]) {
  return messages.filter(message => !message.labels?.some(label => ['DRAFT', 'SPAM', 'TRASH'].includes(label))).at(-1);
}

export function authoredEmailText(message: { body: string; snippet: string }) {
  return (message.body || message.snippet).split(/\n(?:On .+wrote:|[- ]*Original Message[- ]*)/i)[0]
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n');
}

/** Open work owns its thread. Past work owns its particular message, so a new
 * request in an old thread can still get a follow-up. Keep accounts separate. */
export function threadAlreadyRepresented(existing: ExistingDecisionContext[], connectionId: string, threadId: string, messageId: string) {
  return existing.some(item => (!item.sourceAccountId || item.sourceAccountId === connectionId)
    && item.sourceThreadIds?.includes(threadId)
    && (item.status === 'feed' || item.status === 'running' || item.sourceEmailIds?.includes(messageId)));
}
