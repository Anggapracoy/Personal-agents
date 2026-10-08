import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { waitingForUserSql } from '../lib/proactive/engine/waiting-for-user';
import { retryEtaChecks } from '../lib/proactive/engine/detectors/leave-now';

test('wait nudges exclude automatic waits; ETA retry leases are bounded and stop on answer/expiry', { skip: !process.env.RECOVERY_TEST_DATABASE_URL }, async () => {
 const client = postgres(process.env.RECOVERY_TEST_DATABASE_URL!, { max: 1 });
 try {
 const db = drizzle(client);
 await db.execute(sql`create temporary table agent_runs (id text, status text, metadata jsonb)`);
 await db.execute(sql`insert into agent_runs values ('approval','awaiting_approval','{}'),('question','paused','{}'),('email','paused','{"automaticPause":{"eventKind":"gmail_reply"}}'),('timer','paused','{"automaticPause":{"wakeAt":"later"}}'),('done','done','{}')`);
 assert.deepEqual((await db.execute<{id:string}>(sql`select id from agent_runs where ${waitingForUserSql} order by id`)).map(x=>x.id), ['approval','question']);
 await db.execute(sql`create temporary table proactive_eta_checks (id text, owner_email text, destination text, status text, attempts integer default 0, last_requested_at timestamptz, starts_at timestamptz)`);
 const now = new Date('2026-09-26T12:00:00Z');
 await db.execute(sql`insert into proactive_eta_checks (id,owner_email,destination,status,starts_at) values ('retry','a','Office','requested','2026-09-26T13:00:00Z'),('answered','a','Office','answered','2026-09-26T13:00:00Z'),('expired','a','Office','requested','2026-09-26T11:00:00Z'),('other','b','Office','requested','2026-09-26T13:00:00Z')`);
 let sends = 0;
 const send = async () => { sends++; throw Error('missed push'); };
 assert.equal(await retryEtaChecks('a', now, db, send),1);
 assert.equal(await retryEtaChecks('a', now, db, send),0);
 await db.execute(sql`update proactive_eta_checks set status='failed' where id='retry'`);
 assert.equal(await retryEtaChecks('a', new Date(+now+10*60000), db, send),1);
 assert.equal(await retryEtaChecks('a', new Date(+now+20*60000), db, send),1);
 assert.equal(await retryEtaChecks('a', new Date(+now+30*60000), db, send),0);
 assert.equal(sends,3);
 } finally { await client.end(); }
});
