import { authoredEmailText, latestDeliveredMessage, threadAlreadyRepresented } from '../thread-state';
import { waitingForUserSql } from "../waiting-for-user";
import { existingDecisionContextFromWorkspace } from '../../../discovery/existing-decisions';
import { getWorkspaceState } from '../../../workspace-state';
import { proactiveEngineEnabled } from '../candidates';
import { tool } from 'ai';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../../db';
import { getUsableGoogleConnections, type UsableGoogleConnection } from '../../../auth/google-connections';
import { prefilterEmail } from '../../../discovery/prefilter';
import { fetchGmailThread, GoogleApiError } from '../../../google';
import { getLifeProfile } from '../../../life-profile';
import { createTemporalContext } from '../../../temporal';
import type { Decision, WorkspaceStateData } from '../../../types';
import { engineDecision } from '../cards';
import { judgeCandidates, type JudgeItem, type JudgeVerdict } from '../judge';
import { mutedByPreferences, senderAddress } from '../rules';
import { deliverPendingPushNotifications } from '../../../push-notifications';
import { addCandidates, getPreferences, knownDedupeKeys, publishDecisions, type CandidateInput, type EngineDb } from '../store';

type LoopConnection = Pick<UsableGoogleConnection, 'id' | 'email' | 'accessToken'>;
type ThreadMessage = Awaited<ReturnType<typeof fetchGmailThread>>[number];
type LoopItem = JudgeItem & { dedupeKey: string; source: ThreadMessage | null; connection: LoopConnection | null; runId?: string };

const AUTOMATED = /\b(?:no-?reply|notifications?|mailer-daemon|updates?|newsletter|receipts?)@/i;

/** Real people only: no bulk mail, automated senders or anything the prefilter calls noise. */
export function looksHuman(message: Pick<ThreadMessage, 'from' | 'subject' | 'snippet' | 'body' | 'listUnsubscribe' | 'precedence' | 'autoSubmitted'> & Record<string, unknown>) {
  if (message.listUnsubscribe || /\b(?:bulk|list|junk)\b/i.test(message.precedence ?? '') || /auto-/i.test(message.autoSubmitted ?? '')) return false;
  if (AUTOMATED.test(message.from)) return false;
  return prefilterEmail(message as Parameters<typeof prefilterEmail>[0]).bucket !== 'obvious_noise';
}

function daysSince(date: string, now: Date) {
  const time = Date.parse(date);
  return Number.isFinite(time) ? Math.floor((now.getTime() - time) / 86_400_000) : null;
}

function excerpt(message: ThreadMessage) {
  return { from: message.from, to: message.to, subject: message.subject, date: message.date, text: (message.body || message.snippet).slice(0, 1500) };
}

function readThreadTool(connections: LoopConnection[]) {
  return {
    read_thread: tool({
      description: 'Read the full Gmail thread for a candidate when its excerpt is not enough to decide. Rarely needed.',
      inputSchema: z.object({ threadId: z.string().min(1) }),
      execute: async ({ threadId }) => {
        for (const connection of connections) {
          const messages = await fetchGmailThread(connection.accessToken, threadId).catch(() => null);
          if (messages?.length) return { messages: messages.slice(-8).map(excerpt) };
        }
        return { error: 'Thread not found.' };
      },
    }),
  };
}

function loopCard(ownerEmail: string, item: LoopItem, verdict: JudgeVerdict, now: Date): Decision {
  const source = item.source;
  const who = source ? (item.kind === 'loop_waiting' ? source.to : source.from).replace(/<[^>]+>/, '').replace(/"/g, '').trim() : '';
  const options = item.kind === 'loop_owed'
    ? [{ label: 'Draft a reply', sublabel: `Draft a reply to ${who || 'them'} about “${source?.subject}” for my review. Don’t send it.`, actionType: 'approval' as const },
      { label: 'Remind me later', sublabel: 'Remind me about this reply tomorrow.', actionType: 'instant' as const }]
    : item.kind === 'loop_waiting'
      ? [{ label: 'Draft a follow-up', sublabel: `Draft a short, friendly follow-up to ${who || 'them'} about “${source?.subject}” for my review.`, actionType: 'approval' as const },
        { label: 'Give it more time', sublabel: 'Check again in a few days.', actionType: 'instant' as const }]
      : [{ label: 'Help me do it', sublabel: verdict.body, actionType: 'research' as const },
        { label: 'Already done', sublabel: 'This is handled.', actionType: 'no_action' as const }];
  return engineDecision({
    ownerEmail, kind: item.kind, key: item.dedupeKey, category: item.kind === 'promise' ? 'schedule' : 'social', title: verdict.title, body: verdict.body,
    sourceType: source ? 'email' : 'proactive', sourceLabel: source ? 'Email' : 'For you', why: [verdict.reason],
    context: { loop: item.kind, evidence: item.evidence },
    executionContext: source && item.connection ? { sourceAccountId: item.connection.id, sourceAccountEmail: item.connection.email, sourceEmail: {
      messageId: source.id, threadId: source.threadId, from: source.from, to: source.to, subject: source.subject, date: source.date,
      snippet: source.snippet, body: source.body.slice(0, 20_000), links: source.links, confirmationNumbers: source.confirmationNumbers, attachments: source.attachments,
    } } : undefined,
    options, dismissLabel: item.kind === 'promise' ? 'Not a promise' : 'Not a loop', now,
  });
}

/** Tasks waiting on the user for more than a day get exactly one nudge. */
async function stuckTaskCandidates(ownerEmail: string, db: EngineDb): Promise<CandidateInput[]> {
  const rows = await db.execute<{ id: string; title: string }>(sql`
    select id::text as id, title from agent_runs where user_id=${ownerEmail} and ${waitingForUserSql}
      and updated_at < now() - interval '1 day' and updated_at > now() - interval '7 days' limit 5`);
  return rows.map(row => ({
    kind: 'stuck', dedupeKey: `stuck:${row.id}`, title: row.title, body: 'Dash is waiting on your answer to keep going.',
    payload: { notificationId: `run-attention:${row.id}:stuck` },
  }));
}

async function judgeLoopItems(ownerEmail: string, all: LoopItem[], connections: LoopConnection[], now = new Date(), db: EngineDb = getDb()) {
  let created = 0;
  const known = await knownDedupeKeys(ownerEmail, all.map(item => item.dedupeKey), db);
  const preferences = await getPreferences(ownerEmail, db);
  const [workspace] = await db.execute<{ state: WorkspaceStateData }>(sql`select state_json as state from workspace_states where owner_email=${ownerEmail.trim().toLowerCase()}`);
  const existing = workspace ? existingDecisionContextFromWorkspace(workspace.state) : [];
  const fresh = all.filter(item => !known.has(item.dedupeKey)
    && !(item.source && threadAlreadyRepresented(existing, item.connection?.id ?? '', item.source.threadId, item.source.id))
    && !(item.source && preferences.mutedSenders.includes(senderAddress(item.kind === 'loop_waiting' ? item.source.to : item.source.from))));
  if (!fresh.length) return { created };
  if (fresh.length > 25) {
    for (let index = 0; index < fresh.length; index += 25) {
      created += (await judgeLoopItems(ownerEmail, fresh.slice(index, index + 25), connections, now, db)).created;
    }
    return { created };
  }

  const life = await getLifeProfile(ownerEmail);
  const verdicts = await judgeCandidates({ ownerEmail,
    items: fresh.map(({ id, kind, evidence }) => ({ id, kind, evidence })),
    life, temporal: createTemporalContext(life.profile?.timeZone, now), tools: readThreadTool(connections), categoryFeedback: preferences.categoryFeedback,
  });
  const byId = new Map(verdicts.map(verdict => [verdict.id, verdict]));
  const kept = fresh.filter(item => byId.get(item.id)?.keep);
  const cards = kept.map(item => loopCard(ownerEmail, item, byId.get(item.id)!, now)).filter(card => !mutedByPreferences(card, preferences));
  if (cards.length) await publishDecisions(ownerEmail, state => cards.filter(card => {
    const source = card.executionContext?.sourceEmail;
    return !source || !threadAlreadyRepresented(existingDecisionContextFromWorkspace(state), card.executionContext?.sourceAccountId ?? '', source.threadId, source.messageId);
  }));
  created += await addCandidates(ownerEmail, fresh.map((item): CandidateInput => {
    const verdict = byId.get(item.id);
    const card = cards.find(entry => entry.discoveryFingerprint === `proactive:${item.kind}:${item.dedupeKey}`);
    return {
      kind: item.kind, dedupeKey: item.dedupeKey, status: verdict?.keep && card ? 'pending' : 'suppressed',
      decisionId: card?.id ?? null, title: verdict?.title ?? item.kind, body: verdict?.body ?? '', reason: verdict?.reason,
      payload: { notificationId: card?.id, category: card?.category, threadId: item.source?.threadId, lastMessageId: item.source?.id, connectionId: item.connection?.id },
    };
  }), db);
  if (created) await deliverPendingPushNotifications({ownerEmail,includeRecent:true}).catch(()=>undefined);
  return { created };
}

/** A sent message is considered for a promise once, only on its change event.
 * Tracked threads already belong to discovery's combined update/resolution pass. */
export async function detectSentPromises(ownerEmail: string, connection: LoopConnection, messages: ThreadMessage[], now = new Date()) {
  const items: LoopItem[] = messages.filter(message => /\b(i['’]ll|i will|i['’]m going to|i promise)\b/i.test(authoredEmailText(message))).map(message => ({
    id: `promise-${message.id}`, kind: 'promise', dedupeKey: `promise:${connection.id}:${message.id}`, source: message, connection,
    evidence: { yourSentMessage: { ...excerpt(message), text: authoredEmailText(message).slice(0, 1500) } },
  }));
  return judgeLoopItems(ownerEmail, items, [connection], now);
}

export function followUpAt(message: ThreadMessage, accountEmail: string, now = new Date()) {
  if (senderAddress(message.from) !== accountEmail.toLowerCase() || AUTOMATED.test(message.to)
    || message.labels?.some(label => ['DRAFT', 'TRASH', 'SPAM'].includes(label))) return null;
  // Avoid paying for a follow-up verdict on acknowledgements and FYIs. The
  // eventual judge still verifies that this is a real unanswered request.
  const authoredText = authoredEmailText(message);
  if (!/\?|\b(?:please|can you|could you|would you|let me know|send me|any (?:update|news)|checking (?:in|if)|following up|look(?:ing)? forward to|your (?:thoughts|feedback|input))\b/i.test(authoredText)) return null;
  const sentAt = Date.parse(message.date);
  if (!Number.isFinite(sentAt) || now.getTime() - sentAt > 21 * 86_400_000) return null;
  return new Date(Math.max(now.getTime(), sentAt + 4 * 86_400_000));
}

/** One scheduled check, never a mailbox search. A newer message cancels it
 * before any LLM call, including when the change notification was lost/delayed. */
export const followUpServices = { proactiveEngineEnabled, getUsableGoogleConnections, fetchGmailThread, getWorkspaceState, judgeLoopItems };

export async function checkDueFollowUp(ownerEmail: string, connectionId: string, threadId: string, messageId: string, now = new Date(), services = followUpServices) {
  if (!await services.proactiveEngineEnabled(ownerEmail)) return { skipped: 'disabled' };
  const connections = await services.getUsableGoogleConnections(ownerEmail);
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return { skipped: 'disconnected' };
  let thread: Awaited<ReturnType<typeof fetchGmailThread>>;
  try { thread = await services.fetchGmailThread(connection.accessToken, threadId); }
  catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return { skipped: 'thread deleted' };
    throw error;
  }
  const last = latestDeliveredMessage(thread);
  const due = last && followUpAt(last, connection.email, now);
  if (!last || last.id !== messageId || !due || due > now) return { skipped: 'superseded or not due' };
  const { state } = await services.getWorkspaceState(ownerEmail);
  const existing = existingDecisionContextFromWorkspace(state);
  if (threadAlreadyRepresented(existing, connectionId, threadId, messageId)) return { skipped: 'already represented' };
  return services.judgeLoopItems(ownerEmail, [{
    id: `waiting-${threadId}`, kind: 'loop_waiting', dedupeKey: `waiting:${connection.id}:${threadId}:${last.id}`, source: last, connection,
    evidence: { daysSinceYouWrote: daysSince(last.date, now), yourMessage: excerpt(last), earlierMessages: thread.slice(-5, -1).map(excerpt) },
  }], [connection], now);
}

/** No Gmail polling. Cheap DB maintenance retains stuck nudges. */
export async function maintainTaskNudges(ownerEmail: string, db: EngineDb = getDb()) {
  const created = await addCandidates(ownerEmail, await stuckTaskCandidates(ownerEmail, db), db);
  if (created) await deliverPendingPushNotifications({ownerEmail,includeRecent:true}).catch(()=>undefined);
  return created;
}
