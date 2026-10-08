import { messagePreview } from '../../message-preview';
import { isMorningAllowed } from "../morning-access";
import { sql } from 'drizzle-orm';
import { getDb } from '../../../db';
import { getWorkspaceState, putWorkspaceState } from '../../workspace-state';
import type { Decision, WorkspaceStateData } from '../../types';
import { defaultProactivePreferences, type ProactivePreferences } from './rules';

export type EngineDb = Pick<ReturnType<typeof getDb>, 'execute'>;

export type CandidateInput = {
  kind: string; dedupeKey: string; title: string; body: string;
  decisionId?: string | null; reason?: string; payload?: Record<string, unknown>;
  expiresAt?: Date | null;
  /** Record a judged-and-dropped item so it is never judged (or paid for) again. */
  status?: 'pending' | 'suppressed';
};
function owner(value: string) { return value.trim().toLowerCase(); }

/** Idempotent: the same dedupe key never creates a second nudge. */
export async function addCandidates(ownerEmail: string, candidates: CandidateInput[], db: EngineDb = getDb()) {
  let created = 0;
  for (const candidate of candidates) {
    const notificationId = typeof candidate.payload?.notificationId === 'string' && candidate.payload.notificationId
      ? candidate.payload.notificationId : candidate.decisionId ?? candidate.dedupeKey;
    const rows = await db.execute(sql`
      with recorded as (
        insert into proactive_candidates(owner_email,kind,dedupe_key,status,decision_id,title,body,reason,payload,expires_at)
        values (${owner(ownerEmail)},${candidate.kind},${candidate.dedupeKey.slice(0,500)},${candidate.status === 'suppressed' ? 'suppressed' : 'delivered'},${candidate.decisionId ?? null},
          ${candidate.title.slice(0,180)},${candidate.body.slice(0,400)},${candidate.reason?.slice(0,1000) ?? null},${JSON.stringify(candidate.payload ?? {})}::jsonb,
          ${candidate.expiresAt?.toISOString() ?? null}::timestamptz)
        on conflict(owner_email,dedupe_key) do nothing returning id,status
      ), queued as (
        insert into push_notification_jobs(owner_email,decision_id,title,subtitle,body,status)
        select ${owner(ownerEmail)},${notificationId},${messagePreview(candidate.title).slice(0,180)},'',${messagePreview(candidate.body).slice(0,220)},'queued'
        from recorded where status='delivered'
        on conflict(owner_email,decision_id) do nothing returning id
      ) select id from recorded`);
    created += rows.length;
  }
  return created;
}

export async function knownDedupeKeys(ownerEmail: string, keys: string[], db: EngineDb = getDb()) {
  if (!keys.length) return new Set<string>();
  const rows = await db.execute<{ key: string }>(sql`select dedupe_key as key from proactive_candidates
    where owner_email=${owner(ownerEmail)} and dedupe_key in (${sql.join(keys.map(key => sql`${key}`), sql`, `)})`);
  return new Set(rows.map(row => row.key));
}

export async function getPreferences(ownerEmail: string, db: EngineDb = getDb()): Promise<ProactivePreferences> {
  const [row] = await db.execute<ProactivePreferences>(sql`
    select muted_senders as "mutedSenders", muted_topics as "mutedTopics", category_feedback as "categoryFeedback"
    from proactive_preferences where owner_email=${owner(ownerEmail)}`);
  return row ? { ...defaultProactivePreferences, ...row } : defaultProactivePreferences;
}

async function ensurePreferences(ownerEmail: string, db: EngineDb) {
  await db.execute(sql`insert into proactive_preferences (owner_email) values (${owner(ownerEmail)}) on conflict (owner_email) do nothing`);
}

export type FeedbackKind = 'accepted' | 'dismissed' | 'less_like_this' | 'mute_sender' | 'not_a_loop';

/** Every yes and no teaches Dash: counts per category, plus explicit mutes. */
export async function recordFeedback(ownerEmail: string, input: { kind: FeedbackKind; category?: string; topic?: string; sender?: string }, db: EngineDb = getDb()) {
  await ensurePreferences(ownerEmail, db);
  const email = owner(ownerEmail);
  if (input.category && input.kind !== 'mute_sender') {
    const field = input.kind === 'accepted' ? 'yes' : 'no';
    await db.execute(sql`update proactive_preferences set category_feedback = jsonb_set(category_feedback, array[${input.category}]::text[],
      jsonb_build_object('yes', 0, 'no', 0) || coalesce(category_feedback->${input.category}, '{}'::jsonb)
      || jsonb_build_object(${field}::text, coalesce((category_feedback->${input.category}->>${field})::int, 0) + 1),
      true), updated_at=now() where owner_email=${email}`);
  }
  if (input.kind === 'less_like_this' && input.topic) {
    await db.execute(sql`update proactive_preferences set muted_topics = (select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements_text(muted_topics || to_jsonb(${input.topic}::text)) value), updated_at=now() where owner_email=${email}`);
  }
  if (input.kind === 'mute_sender' && input.sender) {
    await db.execute(sql`update proactive_preferences set muted_senders = (select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements_text(muted_senders || to_jsonb(${input.sender.toLowerCase()}::text)) value), updated_at=now() where owner_email=${email}`);
  }
}

/** Adds cards to Home with the same optimistic-version write the discovery worker uses. */
export async function publishDecisions(ownerEmail: string, build: (state: WorkspaceStateData) => Decision[]) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!await isMorningAllowed(ownerEmail)) return [];
    const current = await getWorkspaceState(ownerEmail);
    const state = current.state;
    const known = new Set([...state.decisions.map(item => item.id), ...state.tasks.map(item => item.decisionId), ...state.history.flatMap(item => item.decisionId ? [item.decisionId] : []), ...state.discardedDecisionIds]);
    const additions = build(state).filter(decision => !known.has(decision.id));
    if (!additions.length) return [];
    const result = await putWorkspaceState(ownerEmail, { ...state, decisions: [...additions, ...state.decisions] }, current.preferences, current.version);
    if (!result.conflict) return additions;
  }
  throw new Error('Workspace changed repeatedly while proactive cards were being saved.');
}

/** Removes cards Dash has confirmed are handled or stale, without touching started tasks. */
export async function removeDecisions(ownerEmail: string, ids: string[]) {
  if (!ids.length) return 0;
  const remove = new Set(ids);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await getWorkspaceState(ownerEmail);
    const decisions = current.state.decisions.filter(decision => !(remove.has(decision.id) && !decision.activeRunId));
    const retiredIds = ids.filter(id => !decisions.some(decision => decision.id === id));
    const retireNotifications = async () => {
      if (retiredIds.length) await getDb().execute(sql`update proactive_candidates set status='resolved', updated_at=now()
        where owner_email=${owner(ownerEmail)} and decision_id in (${sql.join(retiredIds.map(id => sql`${id}`), sql`, `)})
          and status in ('pending','delivered','bundled')`);
    };
    if (decisions.length === current.state.decisions.length) { await retireNotifications(); return 0; }
    const result = await putWorkspaceState(ownerEmail, { ...current.state, decisions }, current.preferences, current.version);
    if (!result.conflict) { await retireNotifications(); return current.state.decisions.length - decisions.length; }
  }
  throw new Error('Workspace changed repeatedly while resolved cards were being removed.');
}
