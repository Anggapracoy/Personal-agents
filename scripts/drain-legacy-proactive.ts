/** One-time post-deploy cutover. Inspect by default; --apply queues valid held messages. */
import postgres from 'postgres';
import { getDb } from '../db';
import { proactiveEngineEnabled } from '../lib/proactive/engine/candidates';
import { queueDecisionPushNotifications, queueRunAttentionPushNotification, deliverPendingPushNotifications } from '../lib/push-notifications';
import type { Decision } from '../lib/types';
const apply=process.argv.includes('--apply');
const q=postgres(process.env.DATABASE_URL!,{max:1});
try{
 const owners=await q`select distinct owner_email from proactive_candidates where status='pending'`;
 for(const {owner_email:owner} of owners){
  const rows=await q`select id,kind,decision_id,dedupe_key,title,body,expires_at from proactive_candidates where owner_email=${owner} and status='pending' order by created_at`;
  if(!rows.length)continue;
  const [workspace]=await q`select state_json,preferences_json from workspace_states where owner_email=${owner}`;
  const ids=new Set(rows.filter(r=>!r.kind.startsWith('moment_')).map(r=>r.decision_id));
  const active:Decision[]=(workspace?.state_json?.decisions??[]).filter((d:Decision)=>ids.has(d.id)&&!d.activeRunId&&!d.result&&(!d.actionableUntil||Date.parse(d.actionableUntil)>Date.now())&&!workspace?.preferences_json?.conversations?.[`decision:${d.id}`]?.archived);
  const enabled=await proactiveEngineEnabled(owner);
  console.log(JSON.stringify({pending:rows.length,currentCards:enabled?active.length:0,apply}));
  if(!apply)continue;
  if(enabled&&active.length)await queueDecisionPushNotifications(owner,active);
  for(const row of rows.filter(r=>r.kind==='stuck')){
   const id=String(row.dedupe_key).replace(/^stuck:/,'');
   const [run]=await q`select status,metadata from agent_runs where id::text=${id} and user_id=${owner}`;
   if(enabled&&run&&(run.status==='awaiting_approval'||run.status==='paused'&&!run.metadata?.automaticPause))await queueRunAttentionPushNotification({ownerEmail:owner,runId:id,attentionId:'stuck',title:row.title,body:row.body});
  }
  // Cards remain in the workspace. Retire the old holding records only after
  // their direct notifications have been durably queued or deduplicated.
  await q`update proactive_candidates set status='suppressed',updated_at=now() where id in ${q(rows.map(r=>r.id))} and status='pending'`;
  await deliverPendingPushNotifications({ownerEmail:owner,includeRecent:true},getDb());
 }
}catch(error){console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;}finally{await q.end();process.exit(process.exitCode??0)}
