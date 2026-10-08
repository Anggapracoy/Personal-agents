import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hasUsefulResult } from '../lib/first-use-state';
import { starterDecision, starterRequest, starterForDecision, firstUseFallbackEligible } from '../lib/first-use';
test('first-use completion belongs to the owner and requires an actual completed result', async()=>{
 const pg = new PGlite(); const db = drizzle(pg);
 await pg.exec('create table agent_runs(user_id text,status text,result jsonb,metadata jsonb)');
 const adapter = { execute: async (query: Parameters<typeof db.execute>[0]) => (await db.execute(query)).rows };
 const check=()=>hasUsefulResult('new@example.com', adapter as unknown as Parameters<typeof hasUsefulResult>[1]);
 assert.equal(await check(),false);
 for(const [owner,status,outcome,disposition] of [['other@example.com','done','completed',''],['new@example.com','failed','completed',''],['new@example.com','done','needs_user',''],['new@example.com','done','no_action',''],['new@example.com','done','completed','reaction'],['new@example.com','done','completed','silent']]) {
  await pg.query('insert into agent_runs values($1,$2,$3,$4)',[owner,status,JSON.stringify({outcome}),JSON.stringify({responseDisposition:disposition})]);
  assert.equal(await check(),false);
 }
 await pg.query('insert into agent_runs values($1,$2,$3,$4)',['new@example.com','done',JSON.stringify({outcome:'completed'}),'{}']);
 assert.equal(await check(),true);
 await pg.close();
});
test('each start carries its goal and answered question, without inferring preferences',()=>{
 for(const key of ['shopping','plan','subscription','first-task'] as const) {
  const decision=starterDecision(key,'fixture');
  assert.equal(starterForDecision(decision)?.key,key);
  assert.equal(decision.options.length,0);
  const request=starterRequest(decision,'My actual answer');
  assert.match(request,/My actual answer/);
  assert.ok(request.includes(decision.subtitle));
  assert.match(request,/Do not repeat an answered question/);
 }
 assert.equal(starterForDecision({...starterDecision('plan'),sourceType:'proactive'}),undefined);
});

test('fallback waits for discovery and never replaces findings or a completed first task',()=>{
 const base={firstUse:true,ready:true,visibleCount:0,scanning:false,scanFinished:false,sourceConnected:true,sourcesLoaded:true};
 assert.equal(firstUseFallbackEligible(base),false);
 assert.equal(firstUseFallbackEligible({...base,scanFinished:true}),true);
 assert.equal(firstUseFallbackEligible({...base,sourceConnected:false}),true);
 for(const change of [{scanning:true},{ready:false},{visibleCount:1},{firstUse:false}]) assert.equal(firstUseFallbackEligible({...base,scanFinished:true,...change}),false);
 assert.equal(firstUseFallbackEligible({...base,sourceConnected:false,sourcesLoaded:false}),false);
});
