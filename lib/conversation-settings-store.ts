
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { applyConversationAction, workspaceConversationKeys, type ConversationAction, type ConversationSettings } from './conversation-settings';
import type { WorkspacePreferences, WorkspaceStateData } from './types';

export class ConversationSettingsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function getConversationSettings(email: string, db = getDb()): Promise<ConversationSettings> {
  const rows = await db.execute<{ settings: ConversationSettings }>(sql`select coalesce(preferences_json->'conversations','{}'::jsonb) as settings from workspace_states where owner_email=${email.trim().toLowerCase()}`);
  return rows[0]?.settings ?? {};
}
export async function updateConversationSettings(email: string, action: ConversationAction, db = getDb()) {
  const owner = email.trim().toLowerCase();
  const settings = await db.transaction(async tx => {
    // Serialize menu actions with workspace saves, including requests from other devices.
    const rows = await tx.execute<{ state: WorkspaceStateData; preferences: WorkspacePreferences }>(sql`select state_json as state, preferences_json as preferences from workspace_states where owner_email=${owner} for update`);
    const row = rows[0];
    if (!row) throw new ConversationSettingsError('Your workspace is still saving. Try again in a moment.', 409);
    if (!workspaceConversationKeys(row.state).has(action.key)) {
      const separator = action.key.indexOf(':');
      const kind = action.key.slice(0, separator), id = action.key.slice(separator + 1);
      const owned = await tx.execute(sql`select 1 from agent_runs where user_id=${owner} and (${kind === 'decision' ? sql`decision_id=${id}` : kind === 'run' ? sql`id::text=${id}` : sql`false`}) limit 1`);
      if (!owned.length) throw new ConversationSettingsError('This conversation is no longer available.', 404);
    }
    let settings: ConversationSettings;
    try { settings = applyConversationAction(row.preferences.conversations ?? {}, action); }
    catch (error) { throw new ConversationSettingsError(error instanceof Error ? error.message : 'Could not update conversation.', 409); }
    await tx.execute(sql`update workspace_states set preferences_json=jsonb_set(preferences_json,'{conversations}',${JSON.stringify(settings)}::jsonb,true), version=version+1, updated_at=now() where owner_email=${owner}`);
    return settings;
  });

  return settings;
}

/** Latest visible message from either participant; only incoming messages are unread. */
export async function getConversationMessages(email: string, db = getDb()) {
  const rows = await db.execute<{ key: string; kind: 'user' | 'agent'; text: string; created_at: string; incoming_at: string | null; unread_count: number; reaction: boolean }>(sql`
    with messages as (
      select r.id as run_id, r.decision_id, r.user_id, r.metadata, r.request, r.created_at as run_created_at,
        m.id::text as id, m.seq, m.message, m.created_at,
        m.seq = min(m.seq) over (partition by r.id) as seeded
      from agent_runs r join agent_messages m on m.run_id=r.id
      where r.user_id=${email.trim().toLowerCase()}
      union all
      select r.id, r.decision_id, r.user_id, r.metadata, r.request, r.created_at,
        p->>'id', 2147483647, p->'message', (p->>'createdAt')::timestamptz, false
      from agent_runs r cross join lateral jsonb_array_elements(coalesce(r.metadata->'pendingSteering','[]'::jsonb)) p
      where r.user_id=${email.trim().toLowerCase()}
        and not exists (select 1 from agent_messages m where m.run_id=r.id and m.id::text=p->>'id')
    ), visible as (
      select coalesce('decision:' || m.decision_id, 'run:' || m.run_id::text) as key,
        case when m.message->>'role'='user' then 'user' else 'agent' end as kind,
        m.message->'providerOptions'->'wdyt'->'reaction' is not null as reaction,
        left(case
          when m.message->'providerOptions'->'wdyt'->'reaction' is not null then (case when m.message->>'role'='user' then 'You ' else '' end) || coalesce('reacted ' || (m.message->'providerOptions'->'wdyt'->'reaction'->>'emoji'), 'removed a reaction')
          when m.message->'providerOptions'->'wdyt'->'photoMessage' is not null then coalesce(nullif(m.message->'providerOptions'->'wdyt'->'photoMessage'->>'caption',''), 'Photo')
          when m.message->'providerOptions'->'wdyt'->'videoMessage' is not null then coalesce(nullif(m.message->'providerOptions'->'wdyt'->'videoMessage'->>'caption',''), 'Video')
          when m.message->>'role'='user' and m.seeded then coalesce(m.metadata->>'userMessage', m.metadata->>'customInstruction', m.metadata->>'chosenOption', m.request, '')
          when length(trim(t.body))>0 then t.body
          when m.message->>'role'='user' and jsonb_typeof(m.message->'content')='array' and exists (select 1 from jsonb_array_elements(m.message->'content') part where part->>'type' in ('image','file')) then 'Attachment'
          else '' end, 500) as text,
        case when m.message->>'role'='user' and m.seeded and m.message->'providerOptions'->'wdyt'->'reaction' is null then m.run_created_at else m.created_at end as created_at,
        m.seq, m.id,
        coalesce((w.preferences_json->'conversations'->coalesce('decision:' || m.decision_id, 'run:' || m.run_id::text)->>'lastReadAt')::timestamptz, '-infinity'::timestamptz) as read_at
      from messages m left join workspace_states w on w.owner_email=m.user_id
      cross join lateral (select case
        when jsonb_typeof(m.message->'content')='string' then m.message->>'content'
        when jsonb_typeof(m.message->'content')='array' then
          coalesce((select string_agg(part->>'text', '' order by ordinal)
            from jsonb_array_elements(m.message->'content') with ordinality as parts(part,ordinal)
            where part->>'type'='text' and part->>'text' not like '[attachment context]%'
              and part->>'text' not like '[reply context]%'), '')
        else '' end as body) t
      where m.message->>'role' in ('user','assistant')
        and (m.message->>'role'='assistant' or m.message->'providerOptions'->'wdyt'->'reaction' is not null or t.body not like '[runtime]%')
    )
    select distinct on (key) key, kind, text, created_at, reaction,
      max(created_at) filter (where kind='agent') over (partition by key) as incoming_at,
      count(*) filter (where kind='agent' and created_at>read_at) over (partition by key)::integer as unread_count
    from visible where length(trim(text))>0
    order by key, created_at desc, seq desc, id desc
  `);
  return Object.fromEntries(rows.map(row => [row.key, {
    kind: row.kind, text: row.text, unreadCount: row.unread_count,
    ...(row.reaction ? { reaction: true } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.incoming_at ? { incomingAt: new Date(row.incoming_at).toISOString() } : {}),
  }]));
}
