import { listOpportunities, contextNoise, sourceFromRow, type Opportunity } from './opportunities';
import { getPreferences } from './engine/store';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { getLifeProfile } from '../life-profile';
import { compactLifeMemory } from '../life-memory-context';
import { getWorkspaceState } from '../workspace-state';
import { getUsableGoogleConnections } from '../auth/google-connections';
import { existingDecisionContextFromWorkspace } from '../discovery/existing-decisions';
import { fetchUpcomingEvents } from '../google';
import { createTemporalContext, validTimeZone } from '../temporal';

export { morningMessageText, cleanMorningText } from './personal-context';
import { morningMessageText, cleanMorningText } from './personal-context';

export async function loadMorningContext(ownerInput: string, now = new Date(), claimed: Opportunity[] = []) {
  const owner = ownerInput.trim().toLowerCase();
  const db = getDb();
  const [memory, workspace, runs, schedules, connections, opportunities, feedback] = await Promise.all([
    getLifeProfile(owner), getWorkspaceState(owner),
    db.execute<{ id: string; sourceType: string; title: string; request: string; response: string; status: string; updatedAt: string; createdAt:string; userMessage:string|null;customInstruction:string|null;initialReaction:string|null;chosenOption:string|null;firstUserSeq:number|null;messages: unknown[] }>(sql`
      select r.id, coalesce(r.metadata->>'sourceType', 'unknown') as "sourceType", r.title, r.request, r.response, r.status,r.created_at::text as "createdAt",r.updated_at::text as "updatedAt",r.metadata->>'userMessage' as "userMessage",r.metadata->>'customInstruction' as "customInstruction",r.metadata->>'initialReaction' as "initialReaction",r.metadata->>'chosenOption' as "chosenOption",(select min(seq) from agent_messages where run_id=r.id and message->>'role'='user') as "firstUserSeq",
        coalesce((select jsonb_agg(jsonb_build_object('message',m.message,'createdAt',m.created_at::text,'seq',m.seq) order by m.seq) from (
          select seq,message,created_at from agent_messages where run_id=r.id and message->>'role' in ('user','assistant')
          and (jsonb_typeof(message->'content')='string' or jsonb_path_exists(message, '$.content[*] ? (@.type == "text")'))
          order by seq desc limit 8
        ) m), '[]'::jsonb) as messages
      from agent_runs r where r.user_id=${owner} and (r.updated_at >= ${new Date(now.getTime() - 180 * 86400000).toISOString()}::timestamptz or exists(select 1 from proactive_opportunities p where p.owner_email=${owner} and p.source_run_ids ? r.id::text and p.status in ('open','waiting')))
      order by ${claimed.length?sql`case when r.id::text in (${sql.join([...new Set(claimed.flatMap(lead=>lead.sourceRunIds))].map(id=>sql`${id}`),sql`, `)}) then 0 else 1 end`:sql`0`},r.updated_at desc limit 120`),
    db.execute<{ definition: unknown; status: string; nextRunAt: string | null }>(sql`
      select definition, status, next_run_at::text as "nextRunAt" from scheduled_tasks
      where owner_email=${owner} and status in ('active','paused') order by updated_at desc limit 30`),
    getUsableGoogleConnections(owner), listOpportunities(owner), getPreferences(owner),
  ]);
  const timeZone = validTimeZone(memory.profile?.timeZone);
  if (!timeZone) throw new Error('A saved local timezone is required for morning ideas.');
  const warnings: string[] = [];
  const accounts = await Promise.all(connections.map(async connection => {
    try {
      const events = await fetchUpcomingEvents(connection.accessToken);
      return { calendarComplete: true, events: events.map(event => ({
        ref: `calendar:${connection.id}:${event.id}`, id: event.id, summary: event.summary ?? null,
        location: event.location ?? null, start: event.start ?? null, end: event.end ?? null,
      })) };
    } catch {
      warnings.push(`Calendar unavailable for ${connection.email}`);
      return { calendarComplete: false, events: [] };
    }
  }));
  const compact = compactLifeMemory(memory);
  return {
    owner,
    temporal: createTemporalContext(timeZone, now),
    profile: { ref: 'profile', ...compact.profile },
    facts: memory.facts.filter(fact => fact.lastConfirmedAt).slice(0, 40).map(fact => ({
      ref: `fact:${fact.id}`, kind: fact.kind, value: cleanMorningText(JSON.stringify(fact.value), 1200),
      confirmedAt: fact.lastConfirmedAt, confidence: fact.confidence,
    })),
    conversations: selectMorningConversations(runs, opportunities, claimed, now).map(run => {
      const normalized=sourceFromRow(run);
      return { ref: `chat:${run.id}`, sourceType: run.sourceType, title: run.title,
        request: normalized.request, outcome: cleanMorningText(run.response,2500),status:run.status,updatedAt:run.updatedAt,
        authoredMessages: normalized.userTurns.filter(turn=>turn.authored).map(turn=>({role:'user' as const,text:turn.text,createdAt:turn.at})),
        messages: run.messages.flatMap(entry=>{const text=morningMessageText((entry as {message:unknown}).message);return text?[text]:[];}),
      };
    }),
    calendarComplete: accounts.length > 0 && accounts.every(account => account.calendarComplete),
    calendar: accounts.flatMap(account => account.events),
    // Email is deliberately absent from ideation; targeted verification is tool-only.
    emails: [] as Array<{ ref: string }>,
    // Expiry ends an offer's usefulness, not the user's memory of seeing it.
    existing: existingDecisionContextFromWorkspace(workspace.state, now.getTime(), { includeExpired: true }).map(item => ({ ...item,
      archived: Boolean(workspace.preferences.conversations?.[`decision:${item.id}`]?.archived),
    })),
    schedules: Array.from(schedules), warnings,
    opportunities: opportunities.map(lead=>({...lead, due: claimed.some(item=>item.topicKey===lead.topicKey&&item.revision===lead.revision)})),
    checkedOpportunities: claimed,
    feedback,
    discoveryMode: 'morning' as 'morning'|'opportunity-check',

  };
}
export type MorningContext = Omit<Awaited<ReturnType<typeof loadMorningContext>>, 'opportunities'|'checkedOpportunities'|'feedback'|'discoveryMode'> & Partial<Pick<Awaited<ReturnType<typeof loadMorningContext>>, 'opportunities'|'checkedOpportunities'|'feedback'|'discoveryMode'>>;

export function selectMorningConversations<T extends {id:string;request:string;updatedAt:string;status:string}>(runs:T[],opportunities:Opportunity[],claimed:Opportunity[],now:Date) {
 const dueKeys=new Set(claimed.map(lead=>lead.topicKey));
 const selected=runs.filter(run=>{
  if(contextNoise(run.request))return false;
  const leads=opportunities.filter(lead=>lead.sourceRunIds.includes(run.id));
  if(!leads.length)return true;
  return leads.some(lead=>dueKeys.has(lead.topicKey)||Date.parse(run.updatedAt)>Math.max(Date.parse(lead.evidence.quoteAt),Date.parse(lead.lastCheckedAt??lead.evidence.quoteAt)) && lead.status!=='declined' && lead.status!=='fulfilled' && lead.status!=='expired' && (!lead.nextCheckAt||Date.parse(lead.nextCheckAt)<=now.getTime()));
 });
 const relevant=new Set(claimed.flatMap(lead=>lead.sourceRunIds));
 return selected.sort((a,b)=>Number(relevant.has(b.id))-Number(relevant.has(a.id))||Number(['paused','failed'].includes(b.status))-Number(['paused','failed'].includes(a.status))||Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,40);
}
