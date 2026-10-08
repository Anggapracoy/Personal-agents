import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {PostgresRunStore} from '../lib/harness/store';
const url=process.env.MANUAL_TAKEOVER_TEST_DATABASE_URL;
test('database takeover pauses atomically and fences the active connection even after Continue',{skip:!url},async()=>{
 const a=postgres(url!,{max:1,prepare:false,onnotice:()=>{}}),b=postgres(url!,{max:1,prepare:false,onnotice:()=>{}});
 const schema='takeover_'+crypto.randomUUID().replaceAll('-','');
 try{
  await a.unsafe(`create schema ${schema}`);for(const c of[a,b])await c.unsafe(`set search_path to ${schema}`);
  await a`create table agent_runs(id uuid primary key default gen_random_uuid(),user_id text,decision_id text,category text,request text,title text,status text default 'running',response text default '',result jsonb,error text,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz)`;
  await a`create table agent_actions(id uuid primary key default gen_random_uuid(),run_id uuid,step_id text,scope_id text,tool_name text,risk text,preview text,input jsonb,result jsonb,status text default 'proposed',approved_by text,approved_at timestamptz,executed_at timestamptz,created_at timestamptz default now())`;
  const [row]=await a`insert into agent_runs(user_id) values ('owner') returning id`;
  // Transaction poolers do not preserve a session search_path across BEGIN.
  const scoped = (client: typeof a) => new Proxy(client, { get(target, key) {
    if (key === 'begin') return (callback: (sql: unknown) => Promise<unknown>) => target.begin(async sql => {
      await sql.unsafe(`set local search_path to ${schema}`); return callback(sql);
    });
    return Reflect.get(target, key);
  } });
  const first=new PostgresRunStore(url!,scoped(a)),second=new PostgresRunStore(url!,scoped(b));
  await first.withExecutionLock(row.id,async check=>{
   await check();assert.equal(await second.beginManualTakeover(row.id,'other'),null);
   const action=await second.beginManualTakeover(row.id,'owner','https://example.com');assert.ok(action);
   assert.equal((await b.unsafe(`select status from ${schema}.agent_runs where id=$1`,[row.id]))[0].status,'awaiting_approval');assert.equal((await second.beginManualTakeover(row.id,'owner'))?.id,action.id);
   await assert.rejects(check,/interrupted by browser takeover/);
   await b.unsafe(`update ${schema}.agent_runs set status='running' where id=$1`,[row.id]);await assert.rejects(check,/interrupted by browser takeover/);
  },{loadRun:true});
  assert.equal(Number((await b.unsafe(`select count(*) as n from ${schema}.agent_actions`))[0].n),1);
 }finally{await a.unsafe(`drop schema if exists ${schema} cascade`);await Promise.all([a.end(),b.end()]);}
});
