import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PostgresRunStore } from '../lib/harness/store';
import { appendConversationReply } from '../lib/harness/conversation-reply';
import { recoverRun, STALE_WORKER_MS } from '../lib/harness/recovery';

test('SIGKILL recovery preserves receipts, consumes follow-ups, and adds no recovery chat', { skip: !process.env.CRASH_TEST_DATABASE_URL, timeout: 60000 }, async () => {
 const url = process.env.CRASH_TEST_DATABASE_URL!;
 assert.match(url, /127\.0\.0\.1|localhost/, 'Destructive setup is local-only');
 const store = new PostgresRunStore(url);
 const db = store.sql;
 const ledger = new Map<string, number>();
 const server = createServer(async (req,res) => {
   let key = new URL(req.url!, 'http://localhost').searchParams.get('key') ?? '';
   if (req.method === 'POST') { for await (const chunk of req) key += chunk; ledger.set(key, (ledger.get(key) ?? 0)+1); }
   res.setHeader('content-type','application/json'); res.end(JSON.stringify({ok:ledger.has(key)}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port = (server.address() as {port:number}).port;
 const workers: ReturnType<typeof fork>[] = [];
 const spawn = (runId: string, mode: string) => {
   const child = fork(new URL('./fixtures/crash-worker.ts',import.meta.url), [], {execArgv:['--conditions=react-server','--import','tsx'],env:{...process.env,DATABASE_URL:url,TEST_RUN_ID:runId,TEST_CRASH_MODE:mode,TEST_LEDGER_URL:`http://127.0.0.1:${port}`},stdio:['ignore','pipe','pipe','ipc']});
   let errors=''; child.stderr?.on('data',b=>errors+=b); child.on('exit',code=>{if(code) console.error(errors)}); workers.push(child); return child;
 };
 try {
   for (const file of ['0002_agent_harness.sql','0003_agent_results_and_secrets.sql','0015_agent_messages.sql','0022_user_execution_capacity.sql']) await db.unsafe(await readFile(`db/migrations/${file}`,'utf8'));
   await db`alter table agent_actions add column scope_id text`;
   for (const mode of ['after','during','yield']) {
     const run = await store.createRun({userId:`${mode}@test.invalid`,decisionId:null,category:'social',title:'Recovery test',request:'Record one test item',metadata:{}});
     await store.appendMessages(run.id,[{role:'user',content:'Record one test item'}]);
     const child = spawn(run.id,mode);
     if(mode==='yield') { const [code] = await once(child,'exit'); assert.equal(code,0); }
     else {
       await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error('worker exited before kill point')})]);
       assert.equal(await recoverRun(store,run.id,async()=>{throw Error('must not dispatch while live')},Date.now()+STALE_WORKER_MS+1),false);
       const exit=once(child,'exit'); child.kill('SIGKILL'); await exit;
     }
     assert.equal((await store.getRun(run.id))?.status,'running');
     assert.equal(await appendConversationReply(store,run.id,'Continue with the saved work'),'steering');
     let resumed: ReturnType<typeof fork> | undefined;
     assert.equal(await recoverRun(store,run.id,async()=>{resumed=spawn(run.id,'resume')},Date.now()+STALE_WORKER_MS+1000),true);
     const [code]=await once(resumed!,'exit'); assert.equal(code,0);
     assert.equal(ledger.get(run.id),1,`${mode}: external action executed once`);
     assert.equal((await store.getRun(run.id))?.status,'done');
     const messages=await store.listMessages(run.id);
     assert.equal(messages.filter(m=>m.message.role==='assistant').length,1);
     assert.equal(messages.at(-1)?.message.content,'Completed the requested work.');
     assert.ok(messages.some(m=>m.message.content==='Continue with the saved work'));
   }
 } finally { for(const child of workers) if(child.exitCode===null) child.kill('SIGKILL'); await db.end(); server.close(); }
});
