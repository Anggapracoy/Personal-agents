import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql} from 'drizzle-orm';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {addCandidates} from '../lib/proactive/engine/store';

test('qualified proactive items immediately enqueue individually with atomic dedupe and retry', {skip:!process.env.DELIVERY_TEST_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.DELIVERY_TEST_DATABASE_URL;
 assert.match(process.env.DATABASE_URL!,/127\.0\.0\.1/);const client=postgres(process.env.DATABASE_URL!,{max:4});const db=drizzle(client);
 for(const file of ['0010_remote_push_notifications.sql','0024_proactive_engine.sql','0030_prepare_direct_proactive.sql'])await db.execute(sql.raw(readFileSync(`db/migrations/${file}`,'utf8')));
 const owner=`direct-${crypto.randomUUID()}@example.invalid`;
 const candidates=Array.from({length:8},(_,i)=>({kind:'test',dedupeKey:`item:${i}`,title:`Topic ${i}`,body:`Actual message ${i}`}));
 try{
  await db.execute(sql`insert into proactive_preferences(owner_email,quiet_start,quiet_end,max_buzzes) values(${owner},0,23,0)`);
  await Promise.all(Array.from({length:6},()=>addCandidates(owner,candidates,db)));
  const jobs=await db.execute(sql`select * from push_notification_jobs where owner_email=${owner} order by title`);
  assert.equal(jobs.length,8,'Every qualified item queues even with zero old buzz budget and quiet hours');
  assert.ok(jobs.every(j=>j.status==='queued'));assert.equal(jobs[0].body,'Actual message 0');
  assert.ok((await db.execute(sql`select status from proactive_candidates where owner_email=${owner}`)).every(r=>r.status==='delivered'));
  await addCandidates(owner,[{kind:'test',dedupeKey:'rejected',status:'suppressed',title:'Rejected',body:'Not qualified'}],db);
  assert.equal((await db.execute(sql`select * from push_notification_jobs where owner_email=${owner}`)).length,8);
  await db.execute(sql`alter table push_notification_jobs add constraint direct_test_failure check (title <> 'Retry me')`);
  await assert.rejects(()=>addCandidates(owner,[{kind:'test',dedupeKey:'retry',title:'Retry me',body:'Useful message'}],db));
  assert.equal((await db.execute(sql`select id from proactive_candidates where owner_email=${owner} and dedupe_key='retry'`)).length,0,'Failed queue rolls back the dedupe record');
  await db.execute(sql`alter table push_notification_jobs drop constraint direct_test_failure`);
  await addCandidates(owner,[{kind:'test',dedupeKey:'retry',title:'Retry me',body:'Useful message'}],db);
  assert.equal((await db.execute(sql`select * from push_notification_jobs where owner_email=${owner}`)).length,9);
 }finally{
  await db.execute(sql`alter table push_notification_jobs drop constraint if exists direct_test_failure`);
  await db.execute(sql`delete from push_notification_jobs where owner_email=${owner}`);await db.execute(sql`delete from proactive_candidates where owner_email=${owner}`);await db.execute(sql`delete from proactive_preferences where owner_email=${owner}`);
  await client.end();
 }
});

test('direct decision queue keeps latest pending message and reads current card state', {skip:!process.env.DELIVERY_TEST_DATABASE_URL}, async()=>{
 const client=postgres(process.env.DELIVERY_TEST_DATABASE_URL!,{max:1});
 const {queueDecisionPushNotifications,notificationConversation}=await import('../lib/push-notifications');
 try {
  const db=drizzle(client);
  await db.execute(sql`create temp table workspace_states(owner_email text,state_json jsonb,preferences_json jsonb)`);
  await db.execute(sql`create temp table push_notification_jobs(id uuid default gen_random_uuid(),owner_email text,decision_id text,title text,subtitle text,body text,status text,attempts integer default 0,last_error text,sent_at timestamptz,created_at timestamptz,updated_at timestamptz,unique(owner_email,decision_id))`);
  const owner='revision@example.invalid';
  const original={id:'meeting',title:'Meeting',subtitle:'First message'};
  await db.execute(sql`insert into workspace_states values(${owner},${JSON.stringify({decisions:[original]})}::jsonb,'{}')`);
  await queueDecisionPushNotifications(owner,[original as any],db as any);
  const revised={...original,subtitle:'Latest actual message',discoveryUpdateKey:'new-email'};
  await queueDecisionPushNotifications(owner,[revised as any,revised as any],db as any);
  const rows=await db.execute(sql`select * from push_notification_jobs where status='queued'`);
  assert.equal(rows.length,1);assert.equal(rows[0].body,'Latest actual message');
  const job={ownerEmail:owner,decisionId:String(rows[0].decision_id),title:'',subtitle:''};
  assert.equal((await notificationConversation(job,db as any)).stale,false);
  await db.execute(sql`update workspace_states set state_json='{"decisions":[]}'::jsonb`);
  assert.equal((await notificationConversation(job,db as any)).stale,true);
 }finally{await client.end()}
});
