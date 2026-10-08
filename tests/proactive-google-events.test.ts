import { GoogleApiError } from '../lib/google';
import { latestDeliveredMessage, authoredEmailText, threadAlreadyRepresented } from '../lib/proactive/engine/thread-state';
import { existingDecisionContextFromWorkspace } from '../lib/discovery/existing-decisions';
import test from 'node:test';
import assert from 'node:assert/strict';
import { processGmailChange, gmailChangeServices } from '../lib/discovery/google-push-worker';
import { checkDueFollowUp, followUpAt, followUpServices } from '../lib/proactive/engine/detectors/loops';
import { threadMaintenanceCandidates, validatedResolutions } from '../lib/discovery/thread-maintenance';
import type { DiscoveryInput } from '../lib/discovery/types';
import type { DiscoveryVerdict } from '../lib/discovery/schemas';

const email = (id: string, from = 'person@example.com', threadId = 'thread-1') => ({ id, from, to: 'me@example.com', threadId, date: '2026-09-20T12:00:00Z', subject: 'Question', snippet: 'Can you confirm?', body: 'Can you confirm?', listUnsubscribe: '', precedence: '', autoSubmitted: '', replyTo: '', links: [], attachments: [], confirmationNumbers: [], labels: from === 'me@example.com' ? ['SENT'] : ['INBOX'] });
const state = { decisions: [], tasks: [], history: [], discardedDecisionIds: [] };
const card = (id = 'card', account = 'connection') => ({ id, title: 'Reply to Sam', options: [], createdAt: '2026-09-19T12:00:00Z', executionContext: { sourceAccountId: account, sourceEmail: { ...email('old'), messageId: 'old' } } });
function harness(messages = [email('new')], cards: unknown[] = [], alreadyReviewed: string[] = []) {
  const calls = { discovery: [] as DiscoveryInput[], promises: [] as unknown[][], timers: [] as unknown[], removed: [] as string[], reads: [] as string[], reviewed: [] as string[] };
  let cursor = '1';
  let reviewed: string[] = [...alreadyReviewed];
  let eventReviewed: string[] = [];
  const services = {
    ...gmailChangeServices,
    getGoogleWatchContext: async () => ({ enabled: true, ownerEmail: 'me@example.com', accountEmail: 'me@example.com', connectionId: 'connection', gmailHistoryId: cursor }),
    getGoogleConnectionAccessToken: async () => 'test-token',
    getDiscoveryScanState: async (key: string) => ({ reviewedMessageIds: key.endsWith(':google-events') ? eventReviewed : reviewed, recentEmails: [] }),
    fetchGmailHistoryChanges: async () => ({ historyId: '2', messages: messages.map(m => ({ id: m.id, threadId: m.threadId })) }),
    fetchEmailsByIds: async () => messages,
    fetchGmailThread: async (_token: string, threadId: string) => { calls.reads.push(threadId); return messages.filter(m => m.threadId === threadId); },
    getWorkspaceState: async () => ({ state: { ...state, decisions: cards } }),
    getPrimaryGoogleConnectionId: async () => 'connection',
    getLifeProfile: async () => ({ profile: null, facts: [] }),
    discoveryGuidanceFor: async () => 'enabled',
    detectSentPromises: async (_owner: string, _connection: unknown, items: unknown[]) => { calls.promises.push(items); return { created: 0 }; },
    send: async (event: unknown) => { calls.timers.push(event); return { ids: ['timer'] }; },
    discoverDecisionCards: async (input: DiscoveryInput) => { calls.discovery.push(input); return { decisions: [], reviewedEmailIds: input.emails.map(e => e.id), failedEmailIds: [], resolvedDecisionIds: cards.length ? ['card'] : [] }; },
    removeDecisions: async (_owner: string, ids: string[]) => { calls.removed.push(...ids); return ids.length; },
    mergeDiscoveredDecisions: async () => [],
    rememberReviewedMessages: async (key: string, ids: string[]) => { if (key.endsWith(':google-events')) { eventReviewed = [...eventReviewed, ...ids]; } else { reviewed = [...reviewed, ...ids]; calls.reviewed.push(...ids); } },
    recordGoogleSourceProcessed: async (_id: string, update: { gmailHistoryId: string }) => { cursor = update.gmailHistoryId; },
  } as unknown as typeof gmailChangeServices;
  return { calls, services, run: () => processGmailChange({ connectionId: 'connection', source: 'gmail', historyId: '2' }, services) };
}

test('duplicate Google events process once; one thread read retains every new inbound message', async () => {
  const h = harness([email('new-1'), email('new-2')]);
  await h.run(); await h.run();
  assert.equal(h.calls.discovery.length, 1);
  assert.deepEqual(h.calls.discovery[0].emails.map(e => e.id), ['new-1', 'new-2']);
  assert.deepEqual(h.calls.reads, ['thread-1']);
  assert.deepEqual(h.calls.discovery[0].events, []);
  assert.deepEqual(h.calls.reviewed.sort(), ['new-1', 'new-2']);
});

test('a sent acknowledgement is supplied as evidence and cannot erase incoming obligations', async () => {
  const h = harness([email('incoming'), email('sent', 'me@example.com')]);
  await h.run();
  assert.deepEqual(h.calls.discovery[0].emails.map(e => e.id), ['incoming']);
  assert.ok(h.calls.discovery[0].evidenceEmails?.some(e => e.id === 'sent'));
  assert.equal(h.calls.timers.length, 1);
  assert.equal(h.calls.promises[0].length, 0, 'one investigator owns the changed thread');
});

test('tracked sent thread belongs only to combined discovery, never the promise checker', async () => {
  const h = harness([email('sent', 'me@example.com')], [card()]);
  await h.run();
  assert.deepEqual(h.calls.promises[0], []);
  assert.equal(h.calls.discovery[0].emails.length, 1);
  assert.equal(h.calls.discovery[0].maintainChangedThreads, true);
  assert.deepEqual(h.calls.removed, ['card']);
});

test('other connected account’s cards never become resolution targets', async () => {
  const h = harness([email('incoming')], [card('other', 'other-account')]);
  await h.run();
  assert.equal(h.calls.discovery[0].existingDecisions.length, 0);
});

test('failed discovery does not advance the Gmail cursor or record messages as handled', async () => {
  const h = harness();
  h.services.discoverDecisionCards = async () => { throw new Error('temporary failure'); };
  await assert.rejects(h.run, /temporary failure/);
  assert.equal(h.calls.reviewed.length, 0);
  let retried = 0;
  h.services.discoverDecisionCards = async () => { retried++; return { decisions: [], reviewedEmailIds: ['new'], failedEmailIds: [], failures: [], rejected: [], candidateCount: 0, investigatedCount: 0 }; };
  await h.run();
  assert.equal(retried, 1);
});

test('tracked changed thread skips intake and resolution requires actual new source evidence', () => {
  const input = { emails: [email('new')], existingDecisions: [{ id: 'card', status: 'feed', title: 'Reply', sourceThreadIds: ['thread-1'], sourceEmailIds: ['old'] }], maintainChangedThreads: true, userId: 'test', accessToken: 'test', events: [], lifeMemory: { requiredVersion: 1, profile: null, facts: [] } } as DiscoveryInput;
  const [candidate] = threadMaintenanceCandidates(input);
  assert.deepEqual(candidate.emailIds, ['new']);
  const verdict = { resolvedDecisions: [
    { decisionId: 'card', sourceMessageId: 'new', reason: 'User replied.' },
    { decisionId: 'unrelated', sourceMessageId: 'new', reason: 'Wrong card.' },
    { decisionId: 'card', sourceMessageId: 'old', reason: 'Old evidence.' },
  ] } as DiscoveryVerdict;
  assert.deepEqual(validatedResolutions(input, candidate, verdict), ['card']);
  input.existingDecisions[0].status = 'running';
  assert.deepEqual(validatedResolutions(input, candidate, verdict), []);
});

test('one-off follow-up wakes without an LLM if replied, disconnected, disabled, early, or already represented', async () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const sent = email('sent', 'me@example.com');
  assert.equal(followUpAt(sent, 'me@example.com', new Date('2026-09-20T12:00:00Z'))?.toISOString(), '2026-09-24T12:00:00.000Z');
  let judgments = 0;
  const services = { ...followUpServices,
    proactiveEngineEnabled: async () => true,
    getUsableGoogleConnections: async () => [{ id: 'connection', email: 'me@example.com', accessToken: 'test' }],
    fetchGmailThread: async () => [sent],
    getWorkspaceState: async () => ({ state }),
    judgeLoopItems: async () => { judgments++; return { created: 1 }; },
  } as unknown as typeof followUpServices;
  await checkDueFollowUp('me@example.com', 'connection', 'thread-1', 'sent', now, services);
  assert.equal(judgments, 1);
  services.fetchGmailThread = async () => [sent, email('reply')];
  await checkDueFollowUp('me@example.com', 'connection', 'thread-1', 'sent', now, services);
  services.fetchGmailThread = async () => [sent];
  await checkDueFollowUp('me@example.com', 'connection', 'thread-1', 'sent', new Date('2026-09-21T12:00:00Z'), services);
  await checkDueFollowUp('me@example.com', 'disconnected', 'thread-1', 'sent', now, services);
  services.getWorkspaceState = async () => ({ state: { ...state, decisions: [card()] } }) as never;
  await checkDueFollowUp('me@example.com', 'connection', 'thread-1', 'sent', now, services);
  services.proactiveEngineEnabled = async () => false;
  await checkDueFollowUp('me@example.com', 'connection', 'thread-1', 'sent', now, services);
  assert.equal(judgments, 1);
});

test('acknowledgements and quoted old questions do not schedule model checks', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  const sent = email('sent', 'me@example.com');
  assert.equal(followUpAt({...sent, body:'Thanks, sounds good!'}, 'me@example.com', now), null);
  assert.equal(followUpAt({...sent, body:'Thanks!\nOn Friday Sam wrote:\nCould you confirm?'}, 'me@example.com', now), null);
  assert.equal(followUpAt({...sent, body:'Please send me the revised plan.'}, 'me@example.com', now)?.toISOString(), '2026-09-24T12:00:00.000Z');
});


test('a manual review cannot swallow a reply transition or the outgoing follow-up timer', async () => {
  const h = harness([email('sent', 'me@example.com')], [card()], ['sent']);
  await h.run();
  assert.deepEqual(h.calls.discovery[0].emails.map(e => e.id), ['sent']);
  assert.deepEqual(h.calls.removed, ['card']);
  assert.equal(h.calls.timers.length, 1);
  const alreadySuggested = harness([email('new')], [{ ...card(), executionContext: { sourceAccountId: 'connection', sourceEmail: { ...email('new'), messageId: 'new' } } }], ['new']);
  await alreadySuggested.run();
  assert.equal(alreadySuggested.calls.discovery[0].emails.length, 0, 'manual scan already handled this version; no second investigation');
});

test('drafts never count as replies or hide the real latest message', async () => {
  const incoming = email('incoming');
  const draft = { ...email('draft', 'me@example.com'), labels: ['DRAFT'] };
  assert.equal(latestDeliveredMessage([incoming, draft])?.id, 'incoming');
  const h = harness([incoming, draft]);
  await h.run();
  assert.deepEqual(h.calls.discovery[0].emails.map(e => e.id), ['incoming']);
  assert.equal(h.calls.timers.length, 0);
});

test('deleted threads do not block other changed threads; transient failures retry without inbox rescans', async () => {
  const h = harness([email('gone'), email('alive', 'person@example.com', 'thread-2')]);
  h.services.fetchGmailThread = async (_token, id) => { if (id === 'thread-1') throw new GoogleApiError('Gone',404); return [email('alive','person@example.com','thread-2')]; };
  await h.run();
  assert.deepEqual(h.calls.discovery[0].emails.map(e => e.id), ['alive']);
  const failure = harness();
  failure.services.fetchGmailHistoryChanges = async () => { throw new GoogleApiError('Try later',429); };
  failure.services.fetchRecoveryEmailRefs = async () => { assert.fail('transient failure must not trigger recovery scan'); };
  await assert.rejects(failure.run, /Try later/);
  assert.deepEqual(failure.calls.reviewed,[]);
});

test('expired cursor uses the recovery path once', async () => {
  const h = harness([email('sent','me@example.com')]);
  h.services.fetchGmailHistoryChanges = async () => { throw new GoogleApiError('Expired',404); };
  let recoveries = 0;
  h.services.fetchRecoveryEmailRefs = async () => { recoveries++; return [{id:'sent',threadId:'thread-1'}]; };
  await h.run(); await h.run();
  assert.equal(recoveries,1);
  assert.equal(h.calls.timers.length,1);
});

test('thread ownership separates accounts and past messages from new requests', () => {
  const existing = [{id:'past',title:'Old reply',status:'history' as const,sourceAccountId:'account-a',sourceThreadIds:['thread'],sourceEmailIds:['old']}];
  assert.equal(threadAlreadyRepresented(existing,'account-a','thread','old'),true);
  assert.equal(threadAlreadyRepresented(existing,'account-a','thread','new'),false);
  assert.equal(threadAlreadyRepresented(existing,'account-b','thread','old'),false);
  assert.equal(threadAlreadyRepresented([{...existing[0],status:'running'}],'account-a','thread','new'),true);
  const retryDecision = { ...card(), executionContext: { sourceAccountId:'account-a',sourceEmail:{ ...email('old'), messageId:'old' } } };
  const context = existingDecisionContextFromWorkspace({ ...state, tasks: [{decisionId:'task',title:'Reply',retryDecision}] } as never);
  assert.equal(context[0].sourceAccountId,'account-a');
  assert.deepEqual(context[0].sourceEmailIds,['old']);
  assert.deepEqual(context[0].sourceThreadIds,['thread-1']);
});

test('quoted promises belong to the sender being quoted, not the user', () => {
  assert.equal(authoredEmailText({body:"Thanks!\n> I will send it tomorrow.",snippet:''}),'Thanks!');
  assert.equal(authoredEmailText({body:"Thanks!\nOn Tuesday Sam wrote:\nI will send it tomorrow.",snippet:''}),'Thanks!');
});


test('support mailboxes can receive real follow-ups; no-reply addresses cannot', () => {
  const sent = { ...email('sent','me@example.com'), body:'Could you check why my existing subscription stopped working?' };
  const now = new Date('2026-09-20T12:00:00Z');
  assert.ok(followUpAt({...sent,to:'support@example.com'},'me@example.com',now));
  assert.equal(followUpAt({...sent,to:'no-reply@example.com'},'me@example.com',now),null);
});

test('an unfinished draft after a sent request does not cancel its due follow-up', async () => {
  let calls = 0;
  const services = { ...followUpServices,
    proactiveEngineEnabled: async () => true,
    getUsableGoogleConnections: async () => [{id:'connection',email:'me@example.com',accessToken:'test'}],
    fetchGmailThread: async () => [email('sent','me@example.com'),{...email('draft','me@example.com'),labels:['DRAFT']}],
    getWorkspaceState: async () => ({state}),
    judgeLoopItems: async () => { calls++; return {created:1}; },
  } as unknown as typeof followUpServices;
  await checkDueFollowUp('me@example.com','connection','thread-1','sent',new Date('2026-09-26T12:00:00Z'),services);
  assert.equal(calls,1);
  services.fetchGmailThread = async () => {throw new GoogleApiError('Deleted',404);};
  assert.deepEqual(await checkDueFollowUp('me@example.com','connection','thread-1','sent',new Date(),services),{skipped:'thread deleted'});
});

test('proactive off preserves incoming email Luna discovery but schedules no extra proactive work', async () => {
  const h = harness([email('inbound'), email('outbound', 'me@example.com')]);
  h.services.discoveryGuidanceFor = async () => undefined;
  await h.run();
  assert.equal(h.calls.discovery.length, 1);
  assert.deepEqual(h.calls.discovery[0].emails.map(e => e.id), ['inbound']);
  assert.equal(h.calls.discovery[0].maintainChangedThreads, false);
  assert.deepEqual(h.calls.promises, []);
  assert.deepEqual(h.calls.timers, []);
  assert.deepEqual(h.calls.reads, []);
});
