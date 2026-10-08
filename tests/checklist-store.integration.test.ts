import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {getConversationSettings,updateConversationSettings} from '../lib/conversation-settings-store';
import {getWorkspaceState,putWorkspaceState} from '../lib/workspace-state';
import type {WorkspaceStateData,WorkspacePreferences} from '../lib/types';
const url=process.env.SCHEDULE_TEST_DATABASE_URL;
test('checklist state persists, merges item edits, survives workspace saves, and isolates owners',{skip:!url},async()=>{
 const client=postgres(url!,{max:1,prepare:false,onnotice:()=>{}});const name='checklist_'+crypto.randomUUID().replaceAll('-','');const db=drizzle(client);
 try {
  await client.unsafe(`create schema ${name}`);await client.unsafe(`set search_path to ${name}`);
  assert.equal((await client`select current_schema() as name`)[0].name,name);
  await client`create table workspace_states(owner_email text primary key,state_json jsonb not null,preferences_json jsonb not null,version integer not null,created_at timestamptz default now(),updated_at timestamptz default now())`;
  await client`create table agent_runs(id uuid primary key,user_id text,decision_id text,title text,category text,request text default '',metadata jsonb default '{}',status text default 'done',updated_at timestamptz default now(),created_at timestamptz default now())`;
    await client`create table agent_actions(id uuid primary key,run_id uuid,tool_name text,status text,input jsonb,preview text,created_at timestamptz default now())`;
  const state={decisions:[{id:'chat'}],tasks:[],history:[],discardedDecisionIds:[]} as unknown as WorkspaceStateData;const preferences={} as WorkspacePreferences;
  await putWorkspaceState('owner@test.invalid',state,preferences,0,db);
  await putWorkspaceState('other@test.invalid',{...state,decisions:[]},preferences,0,db);
  await Promise.all(['a','b'].map(itemKey=>updateConversationSettings('owner@test.invalid',{key:'decision:chat',action:'checklist',itemKey,checked:true},db)));
  assert.deepEqual((await getConversationSettings('owner@test.invalid',db))['decision:chat'].checklistItems,{a:true,b:true});
  const current=await getWorkspaceState('owner@test.invalid',db);await putWorkspaceState('owner@test.invalid',state,preferences,current.version,db);
  assert.deepEqual((await getConversationSettings('owner@test.invalid',db))['decision:chat'].checklistItems,{a:true,b:true});
  await updateConversationSettings('owner@test.invalid',{key:'decision:chat',action:'checklist',itemKey:'a',checked:false},db);
  assert.equal((await getConversationSettings('owner@test.invalid',db))['decision:chat'].checklistItems?.a,false);
  await assert.rejects(updateConversationSettings('other@test.invalid',{key:'decision:chat',action:'checklist',itemKey:'b',checked:false},db));
  assert.deepEqual(await getConversationSettings('other@test.invalid',db),{});
 }finally{await client.unsafe(`drop schema if exists ${name} cascade`);await client.end();}
});
