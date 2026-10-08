import { deferOpportunityChecks, recordOpportunityOffers, type Opportunity } from './opportunities';
import { isMorningAllowed, proactivePublicationAllowed, morningAccessPolicy } from './morning-access';
import { callingEnabled } from '../calling-policy';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { decisionCandidate } from './engine/candidates';
import { addCandidates } from './engine/store';
import { createTemporalContext, validTimeZone } from '../temporal';
import type { WorkspaceStateData } from '../types';
import { morningDecisions, type MorningReport, type PreviousMorning } from './morning-ideas';

type MorningDb = Pick<ReturnType<typeof getDb>, 'execute' | 'transaction'>;

export function morningDay(timeZone: unknown, now = new Date()) {
  if (!validTimeZone(timeZone)) return null;
  const temporal = createTemporalContext(timeZone, now);
  const hour = Number(temporal.currentLocalDateTime.slice(11, 13));
  // Start at 6; allow morning catch-up after an outage, never an evening backfill.
  return hour >= 6 && hour < 12 ? temporal.currentLocalDate : null;
}
export async function dueMorningAccounts(now = new Date(), db: MorningDb = getDb()) {
  if (process.env.MORNING_IDEAS_ENABLED === 'false') return [];
  const policy = await morningAccessPolicy(db);
  const rows = await db.execute<{ owner: string; timeZone: string; localDate: string; status: string | null; attempts: number | null; leaseUntil: string | null }>(sql`
    select p.owner_email as owner, p.time_zone as "timeZone", d.local_date::text as "localDate",
      r.status, r.attempts, r.lease_until::text as "leaseUntil"
    from user_life_profiles p
    join mobile_user_states u on u.owner_email=p.owner_email and u.onboarding_completed=true
    join pg_timezone_names tz on tz.name=p.time_zone
    cross join lateral (select (${now.toISOString()}::timestamptz at time zone p.time_zone)::date as local_date) d
    left join morning_idea_runs r on r.owner_email=p.owner_email and r.local_date=d.local_date
    where extract(hour from ${now.toISOString()}::timestamptz at time zone p.time_zone) >= 6
      and extract(hour from ${now.toISOString()}::timestamptz at time zone p.time_zone) < 12
      and (r.owner_email is null or (r.status <> 'completed' and r.attempts < 3 and r.lease_until <= ${now.toISOString()}::timestamptz))`);
  return rows.filter(row => callingEnabled(policy, row.owner)).map(row => ({ owner: row.owner, timeZone: row.timeZone, localDate: row.localDate, attempt: (row.attempts ?? 0) + 1 }));
}
export async function claimMorning(owner: string, timeZone: string, localDate: string, now = new Date(), db: MorningDb = getDb()) {
  if (process.env.MORNING_IDEAS_ENABLED === 'false' || morningDay(timeZone, now) !== localDate || !await isMorningAllowed(owner, db)) return false;
  const rows = await db.execute(sql`
    insert into morning_idea_runs (owner_email, local_date, time_zone, lease_until)
    values (${owner}, ${localDate}::date, ${timeZone}, ${new Date(now.getTime() + 20 * 60000).toISOString()}::timestamptz)
    on conflict (owner_email, local_date) do update set status='running', attempts=morning_idea_runs.attempts+1,
      time_zone=excluded.time_zone, lease_until=excluded.lease_until, started_at=now(), error=null
    where morning_idea_runs.status <> 'completed' and morning_idea_runs.attempts < 3
      and morning_idea_runs.lease_until <= ${now.toISOString()}::timestamptz
    returning attempts`);
  return rows.length ? Number(rows[0].attempts) : false;
}
export async function previousMorningIdeas(owner: string, db: MorningDb = getDb()): Promise<PreviousMorning[]> {
  const rows = await db.execute<{ localDate: string; report: MorningReport | null }>(sql`
    select local_date::text as "localDate", report from morning_idea_runs
    where owner_email=${owner.trim().toLowerCase()} and status='completed' and local_date >= current_date - 7
    order by local_date desc limit 7`);
  return rows.map(row => ({ localDate: row.localDate, ideas: row.report?.ideas ?? [] }));
}
export async function failMorning(owner: string, localDate: string, error: unknown, attempt: number, db: MorningDb = getDb()) {
  await db.execute(sql`update morning_idea_runs set status='failed', error=${error instanceof Error ? error.message.slice(0, 1000) : 'Morning discovery failed'},
    lease_until=now()+interval '10 minutes' where owner_email=${owner} and local_date=${localDate}::date and status='running' and attempts=${attempt}`);
}

/** Publish conversations, enqueue their notifications, and complete the occurrence atomically. */
export async function publishMorning(owner: string, report: MorningReport, attempt: number, db: MorningDb = getDb(), checked: Opportunity[] = []) {
  return db.transaction(async tx => {
    if (process.env.MORNING_IDEAS_ENABLED === 'false' || !await proactivePublicationAllowed(owner, tx)) return { published: 0 };
    const [occurrence] = await tx.execute<{ status: string; attempts: number }>(sql`select status, attempts from morning_idea_runs where owner_email=${owner} and local_date=${report.localDate}::date for update`);
    if (!occurrence || occurrence.status !== 'running' || occurrence.attempts !== attempt) return { published: 0 };
    const [workspace] = await tx.execute<{ state: WorkspaceStateData; preferences: {conversations?:Record<string,{archived?:boolean}>}|null }>(sql`select state_json as state,to_jsonb(workspace_states)->'preferences_json' as preferences from workspace_states where owner_email=${owner} for update`);
    if (!workspace) throw new Error('Workspace is missing for morning discovery.');
    const state = workspace.state;
    const ids = new Set([...state.decisions.map(x => x.id), ...state.tasks.map(x => x.decisionId), ...state.history.flatMap(x => x.decisionId ? [x.decisionId] : []), ...state.discardedDecisionIds]);
    const fingerprints = new Set(state.decisions.filter(x=>!x.activeRunId&&!x.result&&!workspace.preferences?.conversations?.[`decision:${x.id}`]?.archived&&(!x.actionableUntil||Date.parse(x.actionableUntil)>Date.now())).map(x => x.discoveryFingerprint).filter(Boolean));
    const valid=await validOpportunityClaims(owner,checked,tx);
    const eligible={...report,ideas:report.ideas.filter(idea=>idea.personalRefs.filter(ref=>ref.startsWith('opportunity:')).every(ref=>valid.has(ref)))};
    const decisions = morningDecisions(owner, eligible).filter(idea => !ids.has(idea.id) && !fingerprints.has(idea.discoveryFingerprint)
      && Date.parse(idea.actionableUntil!) > Date.now());
    if (decisions.length) await tx.execute(sql`update workspace_states set state_json=${JSON.stringify({ ...state, decisions: [...decisions, ...state.decisions] })}::jsonb,
      version=version+1, updated_at=now() where owner_email=${owner}`);
    // Each notification commits with its Home card; retries cannot lose or duplicate it.
    if (decisions.length) {
      await addCandidates(owner, decisions.map(decision => decisionCandidate(decision, decision.id, 'morning')), tx);
    }
    await deferOpportunityChecks(owner,checked.filter(lead=>valid.has(lead.ref)),report.opportunityChecks??[],new Date(),tx);
    await recordOpportunityOffers(owner,eligible.ideas,decisions,tx);
    // Keep reasoning/provenance, but not raw private account context or full research bodies.
    const saved = { ...report, audit: report.audit.map(item => ({ tool: item.tool, input: item.input })), publishedIds: decisions.map(x => x.id) };
    await tx.execute(sql`update morning_idea_runs set status='completed', completed_at=now(), report=${JSON.stringify(saved)}::jsonb,
      error=null where owner_email=${owner} and local_date=${report.localDate}::date`);
    return { published: decisions.length };
  });
}

async function validOpportunityClaims(owner:string,checked:Opportunity[],db:MorningDb) {
 const valid=new Set<string>();
 if(!checked.length)return valid;
 const rows=await db.execute<{topic_key:string;revision:number}>(sql`select topic_key,revision from proactive_opportunities where owner_email=${owner.trim().toLowerCase()} and status in ('open','waiting') and (valid_until is null or valid_until>now()) and topic_key in (${sql.join(checked.map(lead=>sql`${lead.topicKey}`),sql`, `)}) for update`);
 for(const row of rows)if(checked.some(lead=>lead.topicKey===row.topic_key&&lead.revision===Number(row.revision)))valid.add(`opportunity:${row.topic_key}`);
 return valid;
}
/** Due checks use the same atomic Home + notification publication as mornings. */
export async function publishOpportunityPass(owner:string,report:MorningReport,checked:Opportunity[],db:MorningDb=getDb()) {
 return db.transaction(async tx=>{
  if(!await proactivePublicationAllowed(owner,tx))return {published:0};
  if(!checked.length)return {published:0};
  const [workspace]=await tx.execute<{state:WorkspaceStateData;preferences:{conversations?:Record<string,{archived?:boolean}>}|null}>(sql`select state_json as state,to_jsonb(workspace_states)->'preferences_json' as preferences from workspace_states where owner_email=${owner} for update`);
  if(!workspace)throw new Error('Workspace is missing for proactive opportunity check.');
  const valid=await validOpportunityClaims(owner,checked,tx);if(!valid.size)return {published:0};
  const state=workspace.state,ids=new Set([...state.decisions.map(x=>x.id),...state.tasks.map(x=>x.decisionId),...state.history.flatMap(x=>x.decisionId?[x.decisionId]:[]),...state.discardedDecisionIds]);
  const fingerprints=new Set(state.decisions.filter(x=>!x.activeRunId&&!x.result&&!workspace.preferences?.conversations?.[`decision:${x.id}`]?.archived&&(!x.actionableUntil||Date.parse(x.actionableUntil)>Date.now())).map(x=>x.discoveryFingerprint));
  const eligible={...report,ideas:report.ideas.filter(idea=>idea.personalRefs.some(ref=>valid.has(ref))&&idea.personalRefs.filter(ref=>ref.startsWith('opportunity:')).every(ref=>valid.has(ref)))};
  const decisions=morningDecisions(owner,eligible).filter(d=>!ids.has(d.id)&&!fingerprints.has(d.discoveryFingerprint)&&Date.parse(d.actionableUntil!)>Date.now());
  if(decisions.length){await tx.execute(sql`update workspace_states set state_json=${JSON.stringify({...state,decisions:[...decisions,...state.decisions]})}::jsonb,version=version+1,updated_at=now() where owner_email=${owner}`);await addCandidates(owner,decisions.map(d=>decisionCandidate(d,d.id,'opportunity')),tx);}
  await deferOpportunityChecks(owner,checked.filter(lead=>valid.has(lead.ref)),report.opportunityChecks??[],new Date(),tx);
  await recordOpportunityOffers(owner,eligible.ideas,decisions,tx);
  return {published:decisions.length};
 });
}
