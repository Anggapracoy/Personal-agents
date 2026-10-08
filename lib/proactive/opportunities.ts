import { isMorningAllowed, proactivePublicationAllowed } from './morning-access';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { cleanMorningText } from './personal-context';
import { extractOpportunities, opportunityUpdateSchema, type OpportunityUpdate } from './opportunity-model';
import type { Decision } from '../types';
import type { FeedbackKind } from './engine/store';
export type OpportunityDb=Pick<ReturnType<typeof getDb>,'execute'|'transaction'>;
export type OpportunitySource={id:string;decisionId?:string|null;title:string;sourceType:string;status:string;updatedAt:string;createdAt:string;request:string;outcome:string;result:{outcome?:string;verified?:boolean;externalChange?:boolean;summary?:string;details?:string}|null;userTurns:Array<{text:string;at:string;authored?:boolean}>};
export type Opportunity={ref:string;topicKey:string;kind:'goal'|'plan'|'interest'|'routine';status:'open'|'waiting'|'fulfilled'|'declined'|'expired';title:string;summary:string;category:string;evidence:{deadlineKind?:OpportunityUpdate['deadlineKind'];deadlineQuote?:string|null;basis?:OpportunityUpdate['basis'];supportingEvidence?:Array<OpportunityUpdate['supportingEvidence'][number]&{requestAt?:string;verifiedAt?:string}>;sourceRunId:string;quote:string;quoteAt:string};evidenceKey:string;sourceRunIds:string[];nextCheckAt:string|null;validUntil?:string|null;requiredChange:string;lastCheckedAt:string|null;lastObservation?:{summary:string;sourceUrls:string[];checkedAt:string}|null;lastOfferedAt:string|null;lastOffer:{topicKey?:string;title:string;body:string;whyNow:string;intent:string;decisionId:string}|null;closedAt:string|null;revision:number};
const owner=(email:string)=>email.trim().toLowerCase();
const iso=(value:unknown)=>value&&Number.isFinite(Date.parse(String(value)))?new Date(String(value)).toISOString():null;
export function contextNoise(request:string) {
 return /^(?:do|play|solve)\b[^\n]{0,40}\bwordle\b/i.test(request.trim()) || /\b(?:test form|test flow|test feature|structured outputs?|connector capabilities)\b/i.test(request)
 || /^(?:what can (?:you|u)|who (?:are|r) (?:you|u)|log\s?in to)\b/i.test(request.trim());
}
function normalize(row:Record<string,unknown>):Opportunity {return {ref:`opportunity:${row.topic_key}`,topicKey:String(row.topic_key),kind:row.kind as Opportunity['kind'],status:row.status as Opportunity['status'],title:String(row.title),summary:String(row.summary),category:String(row.category),evidence:row.evidence as Opportunity['evidence'],evidenceKey:String(row.evidence_key),sourceRunIds:row.source_run_ids as string[],nextCheckAt:iso(row.next_check_at),validUntil:iso(row.valid_until),requiredChange:String(row.required_change),lastCheckedAt:iso(row.last_checked_at),lastObservation:row.last_observation as Opportunity['lastObservation'],lastOfferedAt:iso(row.last_offered_at),lastOffer:row.last_offer as Opportunity['lastOffer'],closedAt:iso(row.closed_at),revision:Number(row.revision)};}
export async function listOpportunities(email:string,db:OpportunityDb=getDb()) {
 return (await db.execute<Record<string,unknown>>(sql`select * from proactive_opportunities where owner_email=${owner(email)} order by next_check_at nulls last,updated_at desc limit 200`)).map(normalize);
}
export function sourceFromRow(row:Record<string,unknown>):OpportunitySource {
 const messages=Array.isArray(row.messages)?row.messages as Array<{message:{role?:string;content?:unknown};createdAt:string}>:[];
 const initialAuthored=!row.initialReaction&&(row.sourceType==='manual'||Boolean(row.userMessage)||Boolean(row.customInstruction));
 const initial=cleanMorningText(String(row.userMessage??row.customInstruction??(row.sourceType==='manual'?row.request:row.chosenOption)??''));
 const firstSeq=row.firstUserSeq===undefined?Math.min(...messages.map((entry)=>Number((entry as {seq?:number}).seq??Infinity))):Number(row.firstUserSeq);
 const turns=[{text:initial,at:String(row.createdAt),authored:Boolean(initialAuthored)},...messages.flatMap((entry,index)=>{
  const {message,createdAt}=entry;
  if(message.role!=='user')return [];
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.flatMap(p=>p?.type==='text'?[p.text]:[]).join('\n'):'';
  const seed=text.includes('\n\nTemporal context:')||Number((entry as {seq?:number}).seq??(index===0?firstSeq:Infinity))===firstSeq&&row.sourceType!=='manual'&&!initialAuthored;
  const visible=cleanMorningText(seed?initial:text,3000);
  if(visible.startsWith('[runtime]'))return [];
  return visible?[{text:visible,at:createdAt,authored:seed?Boolean(initialAuthored):true}]:[];
 })];
 const request=turns.findLast(turn=>turn.authored)?.text??(initialAuthored?initial:'');
 return {id:String(row.id),decisionId:row.decisionId?String(row.decisionId):null,title:cleanMorningText(String(row.title),200),sourceType:String(row.sourceType),status:String(row.status),updatedAt:iso(row.updatedAt)!,createdAt:iso(row.createdAt)!,request,outcome:cleanMorningText(String(row.response??''),2500),result:row.result&&typeof row.result==='object'?{outcome:String((row.result as {outcome?:string}).outcome??''),verified:(row.result as {verified?:boolean}).verified===true,externalChange:(row.result as {externalChange?:boolean}).externalChange===true,...{summary:cleanMorningText(String((row.result as {summary?:string}).summary??''),1500),details:cleanMorningText(String((row.result as {details?:string}).details??''),2000)}}:null,userTurns:turns};
}
export function groundedOpportunity(update:OpportunityUpdate,sources:OpportunitySource[],existing:Opportunity[],now:Date) {
 const parsed=opportunityUpdateSchema.safeParse({...update,validUntil:update.validUntil??null});if(!parsed.success)return null;
 const u=parsed.data,source=sources.find(s=>s.id===u.sourceRunId),old=existing.find(x=>x.topicKey===u.topicKey);
 if(!source||contextNoise(source.request))return null;
 const linked = source.sourceType!=='manual' && Boolean(source.decisionId) && old?.lastOffer?.decisionId===source.decisionId;
 const verifiedBehavior=u.basis==='repeated_purchase'&&source.status==='done'&&source.result?.outcome==='completed'&&source.result.verified&&source.result.externalChange;
 const hasAuthored=source.userTurns.some(turn=>turn.authored??source.sourceType==='manual');
 if(!hasAuthored&&!linked&&!verifiedBehavior)return null;
 const turn=source.userTurns.findLast(t=>(t.authored??source.sourceType==='manual')&&t.text.includes(u.quote))??(verifiedBehavior?source.userTurns.findLast(t=>t.text.includes(u.quote)):undefined)??(linked&&old?.evidence.quote===u.quote?{text:u.quote,at:old.evidence.quoteAt}:undefined);if(!turn)return null;
 if(old&&['fulfilled','declined','expired'].includes(old.status)&&['open','waiting'].includes(u.status)&&(!u.reopen||!old.closedAt||Date.parse(turn.at)<=Date.parse(old.closedAt)))return null;
 if(u.status==='fulfilled' && !(source.result?.outcome==='completed'&&source.result.verified===true))return null;
 const next=iso(u.nextCheckAt),validUntil=iso(u.validUntil);if(u.nextCheckAt&&!next||u.validUntil&&!validUntil)return null;
 if(u.deadlineKind!=='hard_deadline'&&(validUntil||u.deadlineQuote))return null;
 if(validUntil) {
  if(u.deadlineKind!=='hard_deadline'||!u.deadlineQuote)return null;
  const userProof=source.userTurns.some(t=>(t.authored??source.sourceType==='manual')&&t.text.includes(u.deadlineQuote!));
  const fixedOutcome=source.result?.verified===true&&[source.outcome,source.result.summary??'',source.result.details??''].some(text=>text.includes(u.deadlineQuote!));
  if(!userProof&&!fixedOutcome)return null;
 }
 if(validUntil&&Date.parse(validUntil)<=now.getTime()&&['open','waiting'].includes(u.status))return null;
 if(u.status==='expired'&&(!validUntil||Date.parse(validUntil)>now.getTime()))return null;
 if(['open','waiting'].includes(u.status)&&!next)return null;
 const support=u.supportingEvidence;
 if(u.basis!=='repeated_purchase'&&u.quote.length<8)return null;
 if(['interest','routine'].includes(u.kind)&&u.status==='fulfilled')return null;
 if(u.basis==='repeated_purchase') {
  if(u.kind!=='routine'||support.length<2||!support.some(item=>item.sourceRunId===source.id)||new Set(support.map(item=>item.sourceRunId)).size!==support.length)return null;
  const supported=support.map(item=>({item,source:sources.find(candidate=>candidate.id===item.sourceRunId)}));
  if(supported.some(({item,source:proof})=>!proof||proof.status!=='done'||proof.result?.outcome!=='completed'||!proof.result.verified||!proof.result.externalChange||!proof.userTurns.some(turn=>turn.text.includes(item.quote))||![proof.outcome,proof.result.summary??'',proof.result.details??''].some(text=>text.includes(item.resultQuote))))return null;
  const dates=supported.map(({source:proof})=>Date.parse(proof!.createdAt));
  if(Math.max(...dates)-Math.min(...dates)<86400000)return null;
 }
 if(u.kind==='interest'&&u.basis!=='explicit_preference')return null;
 if(u.kind==='routine'&&!['explicit_preference','repeated_purchase'].includes(u.basis))return null;
 const evidence={deadlineKind:u.deadlineKind,deadlineQuote:u.deadlineQuote?cleanMorningText(u.deadlineQuote,600):null,basis:u.basis,supportingEvidence:support.map(item=>({...item,requestAt:sources.find(proof=>proof.id===item.sourceRunId)?.createdAt,verifiedAt:sources.find(proof=>proof.id===item.sourceRunId)?.updatedAt,quote:cleanMorningText(item.quote,600),resultQuote:cleanMorningText(item.resultQuote,600)})),sourceRunId:linked?old!.evidence.sourceRunId:source.id, ...(linked?{resolutionRunId:source.id}:{}),quote:cleanMorningText(u.quote,600),quoteAt:turn.at};
 return { ...u, validUntil, nextCheckAt:['fulfilled','declined','expired'].includes(u.status)?null:new Date(Math.min(now.getTime()+365*86400000,Math.max(Math.min(Date.parse(next!),validUntil?Math.max(now.getTime(),Date.parse(validUntil)-30*60000):Infinity),now.getTime()))).toISOString(), evidence,
  evidenceKey:createHash('sha256').update(JSON.stringify([evidence,u.status,u.summary,u.requiredChange])).digest('hex'),sourceRunIds:[...new Set([...(old?.sourceRunIds??[]),source.id,...support.map(item=>item.sourceRunId)])].slice(-30) };
}
/** A fenced lease prevents two extractors overwriting newer feedback or each other. */
export async function refreshOpportunities(email:string,options:{db?:OpportunityDb;now?:Date;extract?:typeof extractOpportunities}={}) {
 const db=options.db??getDb(),now=options.now??new Date(),who=owner(email),token=randomUUID();
 if(!await isMorningAllowed(who,db))return {processed:0,saved:0,busy:false,disabled:true};
 const [claim]=await db.execute(sql`insert into proactive_opportunity_refreshes values(${who},${new Date(now.getTime()+10*60000).toISOString()}::timestamptz,${token}::uuid)
  on conflict(owner_email) do update set lease_until=excluded.lease_until,lease_token=excluded.lease_token where proactive_opportunity_refreshes.lease_until<=${now.toISOString()}::timestamptz returning owner_email`);
 if(!claim)return {processed:0,saved:0,busy:true};
 try {
  const rows=await db.execute<Record<string,unknown>>(sql`select r.id::text,r.decision_id as "decisionId",r.title,r.request,r.response,r.status,r.result,r.created_at::text as "createdAt",r.updated_at::text as "updatedAt",coalesce(r.metadata->>'sourceType','unknown') as "sourceType",r.metadata->>'userMessage' as "userMessage",r.metadata->>'chosenOption' as "chosenOption",r.metadata->>'customInstruction' as "customInstruction",r.metadata->>'initialReaction' as "initialReaction",(select min(seq) from agent_messages where run_id=r.id and message->>'role'='user') as "firstUserSeq",
   coalesce((select jsonb_agg(jsonb_build_object('message',m.message,'createdAt',m.created_at::text,'seq',m.seq) order by m.seq) from (select seq,message,created_at from agent_messages where run_id=r.id and message->>'role'='user' order by seq desc limit 8)m),'[]'::jsonb) as messages
   from agent_runs r left join proactive_opportunity_sources p on p.owner_email=${who} and p.run_id=r.id
   where r.user_id=${who} and r.status not in ('planning','running') and (coalesce(r.metadata->>'sourceType','unknown')='manual' or (r.result->>'outcome'='completed' and r.result->>'verified'='true' and r.result->>'externalChange'='true') or ((r.metadata->>'customInstruction' is not null or r.metadata->>'userMessage' is not null) and r.metadata->>'initialReaction' is null) or exists(select 1 from agent_messages m where m.run_id=r.id and m.message->>'role'='user' and m.seq>(select min(first.seq) from agent_messages first where first.run_id=r.id and first.message->>'role'='user')) or exists(select 1 from proactive_opportunities o where o.owner_email=${who} and o.last_offer->>'decisionId'=r.decision_id)) and (p.run_id is null or p.source_updated_at<r.updated_at)
    and r.updated_at>=${new Date(now.getTime()-180*86400000).toISOString()}::timestamptz
   order by r.updated_at desc,r.id limit 40`);
  const changedSources=rows.map(sourceFromRow),existing=await listOpportunities(who,db);
  const referenceRows=changedSources.length?await db.execute<Record<string,unknown>>(sql`select r.id::text,r.decision_id as "decisionId",r.title,r.request,r.response,r.status,r.result,r.created_at::text as "createdAt",r.updated_at::text as "updatedAt",r.metadata->>'sourceType' as "sourceType",r.metadata->>'userMessage' as "userMessage",r.metadata->>'chosenOption' as "chosenOption",r.metadata->>'customInstruction' as "customInstruction",r.metadata->>'initialReaction' as "initialReaction",(select min(seq) from agent_messages where run_id=r.id and message->>'role'='user') as "firstUserSeq",
   coalesce((select jsonb_agg(jsonb_build_object('message',m.message,'createdAt',m.created_at::text,'seq',m.seq) order by m.seq) from (select seq,message,created_at from agent_messages where run_id=r.id and message->>'role'='user' order by seq desc limit 8)m),'[]'::jsonb) as messages
   from agent_runs r where r.user_id=${who} and r.status='done' and r.result->>'outcome'='completed' and r.result->>'verified'='true' and r.result->>'externalChange'='true' and r.created_at>=${new Date(now.getTime()-180*86400000).toISOString()}::timestamptz order by r.created_at desc limit 50`):[];
  const sources=[...new Map([...referenceRows.map(sourceFromRow),...changedSources].map(source=>[source.id,source])).values()];
  const relevant=changedSources.filter(s=>!contextNoise(s.request)&&(s.userTurns.some(turn=>turn.authored??s.sourceType==='manual')||s.result?.outcome==='completed'&&s.result.verified&&s.result.externalChange||existing.some(lead=>lead.lastOffer?.decisionId===s.decisionId)));
  const schedules=relevant.length?await db.execute<{title:string;nextRunAt:string|null}>(sql`select definition->>'title' as title,next_run_at::text as "nextRunAt" from scheduled_tasks where owner_email=${who} and status='active' limit 50`):[];
  const [profile]=relevant.length?await db.execute<{timeZone:string}>(sql`select time_zone as "timeZone" from user_life_profiles where owner_email=${who}`):[];
  const updates=relevant.length?await (options.extract??extractOpportunities)(who,sources.filter(s=>!contextNoise(s.request)),existing,now,{changedSourceIds:changedSources.map(source=>source.id),schedules,timeZone:profile?.timeZone}):[];
  let saved=0;
  await db.transaction(async tx=>{
   if(!await proactivePublicationAllowed(who,tx))throw new Error('Proactive access was disabled during opportunity extraction.');
   const usedIds=new Set([...changedSources.map(source=>source.id),...updates.flatMap(update=>update.supportingEvidence.map(item=>item.sourceRunId))]);
   const checkedSources=sources.filter(source=>usedIds.has(source.id));
   if(checkedSources.length) {
    const currentSources=await tx.execute<{id:string;updatedAt:string}>(sql`select id::text,updated_at::text as "updatedAt" from agent_runs where user_id=${who} and id in (${sql.join(checkedSources.map(source=>sql`${source.id}::uuid`),sql`, `)}) order by id for share`);
    if(currentSources.length!==checkedSources.length||currentSources.some(row=>Date.parse(row.updatedAt)!==Date.parse(sources.find(source=>source.id===row.id)!.updatedAt)))throw new Error('Personal source changed or was deleted during extraction.');
   }
   const [lease]=await tx.execute(sql`select owner_email from proactive_opportunity_refreshes where owner_email=${who} and lease_token=${token}::uuid and lease_until>${now.toISOString()}::timestamptz for update`);if(!lease)throw new Error('Opportunity refresh lease was replaced.');
   for(const update of updates) {
    if(!changedSources.some(source=>source.id===update.sourceRunId))continue;
    const prior=existing.find(x=>x.topicKey===update.topicKey);
    const [currentRow]=await tx.execute<Record<string,unknown>>(sql`select * from proactive_opportunities where owner_email=${who} and topic_key=${update.topicKey} for update`);
    const current=currentRow?normalize(currentRow):undefined;
    if(prior&&current&&prior.revision!==current.revision)throw new Error('Opportunity changed while context was being classified.');
    const candidate=current&&!prior&&!['interest','routine'].includes(current.kind)?{...update,reopen:true}:update;
    const valid=groundedOpportunity(candidate,sources,current?[current]:existing,now);if(!valid)continue;
    const old=current??prior;
    if(old?.evidenceKey===valid.evidenceKey)continue;
    const [written]=await tx.execute(sql`insert into proactive_opportunities(owner_email,topic_key,kind,status,title,summary,category,evidence,evidence_key,source_run_ids,next_check_at,valid_until,required_change,closed_at,updated_at)
      values(${who},${valid.topicKey},${valid.kind},${valid.status},${valid.title},${cleanMorningText(valid.summary,1200)},${valid.category},${JSON.stringify(valid.evidence)}::jsonb,${valid.evidenceKey},${JSON.stringify(valid.sourceRunIds)}::jsonb,${valid.nextCheckAt}::timestamptz,${valid.validUntil}::timestamptz,${cleanMorningText(valid.requiredChange,600)},${['fulfilled','declined','expired'].includes(valid.status)?now.toISOString():null}::timestamptz,${now.toISOString()}::timestamptz)
      on conflict(owner_email,topic_key) do update set kind=excluded.kind,status=excluded.status,title=excluded.title,summary=excluded.summary,category=excluded.category,evidence=excluded.evidence,evidence_key=excluded.evidence_key,source_run_ids=excluded.source_run_ids,next_check_at=excluded.next_check_at,valid_until=excluded.valid_until,required_change=excluded.required_change,closed_at=excluded.closed_at,revision=proactive_opportunities.revision+1,updated_at=excluded.updated_at
      where proactive_opportunities.revision=${old?.revision??0} returning topic_key`);if(written)saved++;else throw new Error('Opportunity changed while context was being classified.');
   }
   for(const source of changedSources)await tx.execute(sql`insert into proactive_opportunity_sources(owner_email,run_id,source_updated_at) values(${who},${source.id}::uuid,${source.updatedAt}::timestamptz)
    on conflict(owner_email,run_id) do update set source_updated_at=excluded.source_updated_at,classified_at=now() where proactive_opportunity_sources.source_updated_at<excluded.source_updated_at`);
  });
  return {processed:changedSources.length,saved,busy:false};
 }finally{await db.execute(sql`update proactive_opportunity_refreshes set lease_until=${now.toISOString()}::timestamptz where owner_email=${who} and lease_token=${token}::uuid`);}
}
export function opportunityDue(lead:Opportunity,now:Date) {return ['open','waiting'].includes(lead.status)&&Boolean(lead.nextCheckAt)&&Date.parse(lead.nextCheckAt!)<=now.getTime()&&(!lead.validUntil||Date.parse(lead.validUntil)>now.getTime());}
/** Save the next check even when research correctly produced no suggestion. */
export async function deferOpportunityChecks(email:string,leads:Opportunity[],updates:Array<{ref:string;nextCheckAt:string;requiredChange:string;observation?:string|null;sourceUrls?:string[]}>,now=new Date(),db:OpportunityDb=getDb()) {
 for(const lead of leads) {
  const update=updates.find(x=>x.ref===lead.ref),requested=update?Date.parse(update.nextCheckAt):NaN;
  const next=Number.isFinite(requested)?Math.min(now.getTime()+365*86400000,Math.max(now.getTime()+30*60000,requested)):now.getTime()+3*86400000;
  await db.execute(sql`update proactive_opportunities set next_check_at=${new Date(next).toISOString()}::timestamptz,required_change=${update?cleanMorningText(update.requiredChange,600):lead.requiredChange},last_checked_at=${now.toISOString()}::timestamptz,last_observation=${JSON.stringify(update?.observation?{summary:cleanMorningText(update.observation,1600),sourceUrls:update.sourceUrls??[],checkedAt:now.toISOString()}:lead.lastObservation??null)}::jsonb,revision=revision+1,updated_at=now()
   where owner_email=${owner(email)} and topic_key=${lead.topicKey} and revision=${lead.revision} and status in ('open','waiting')`);
 }
}
export async function recordOpportunityOffers(email:string,ideas:Array<{topicKey:string;personalRefs:string[];title:string;body:string;whyNow:string;primary:{intent:string}}>,decisions:Decision[],db:OpportunityDb=getDb()) {
 for(const idea of ideas)for(const ref of idea.personalRefs.filter(ref=>ref.startsWith('opportunity:'))) {
  const decision=decisions.find(d=>d.discoveryFingerprint===`morning:${idea.topicKey.toLowerCase().trim()}`);if(!decision)continue;
  await db.execute(sql`update proactive_opportunities set last_offered_at=now(),last_offer=${JSON.stringify({topicKey:idea.topicKey,title:idea.title,body:idea.body,whyNow:idea.whyNow,intent:idea.primary.intent,decisionId:decision.id})}::jsonb,revision=revision+1,updated_at=now() where owner_email=${owner(email)} and topic_key=${ref.slice('opportunity:'.length)} and status in ('open','waiting')`);
 }
}
export async function recordOpportunityFeedback(email:string,decisionId:string,kind:FeedbackKind,db:OpportunityDb=getDb()) {
 if(!['accepted','dismissed','less_like_this','not_a_loop'].includes(kind)||!await isMorningAllowed(email,db))return;
 const declined=kind==='less_like_this'||kind==='not_a_loop';
 await db.execute(sql`update proactive_opportunities set status=${declined?'declined':'waiting'},closed_at=${declined?new Date().toISOString():null}::timestamptz,
  next_check_at=${declined?null:new Date(Date.now()+(kind==='accepted'?2:7)*86400000).toISOString()}::timestamptz,
  required_change=${kind==='accepted'?'Check the accepted task outcome; do not offer work already underway.': 'Do not repeat this offer. New user context or a verified material change is required.'},revision=revision+1,updated_at=now()
  where owner_email=${owner(email)} and last_offer->>'decisionId'=${decisionId}`);
}

/** Claim only due leads. Future plans are not looked up again until their check is due. */
export async function claimOpportunityChecks(email:string,now=new Date(),db:OpportunityDb=getDb()) {
 if(!await isMorningAllowed(email,db))return [];
 await db.execute(sql`update proactive_opportunities set status='expired',closed_at=${now.toISOString()}::timestamptz,next_check_at=null,revision=revision+1,updated_at=now() where owner_email=${owner(email)} and status in ('open','waiting') and valid_until<=${now.toISOString()}::timestamptz`);
 return (await db.execute<Record<string,unknown>>(sql`update proactive_opportunities set next_check_at=${new Date(now.getTime()+15*60000).toISOString()}::timestamptz,revision=revision+1
  where (owner_email,topic_key) in (select owner_email,topic_key from proactive_opportunities where owner_email=${owner(email)} and status in ('open','waiting') and next_check_at<=${now.toISOString()}::timestamptz order by next_check_at limit 30 for update skip locked) returning *`)).map(normalize);
}
