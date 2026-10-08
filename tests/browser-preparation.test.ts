import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPreparation } from '../lib/harness/browser/preparation';
import { withExecutionOwnership } from '../lib/harness/execution-lock';

test('browser preparation starts once on declared tool input, without waiting for arguments',async()=>{
  let calls=0;let finish!:()=>void;
  const gate=new Promise<void>(resolve=>{finish=resolve});
  const prepare=createBrowserPreparation(async()=>{calls++;await gate});
  for(const part of [{type:'text-delta'},{type:'tool-input-start',toolName:'gmail_search_messages'},{type:'tool-input-start',toolName:'browser_close'},{type:'tool-call',toolName:'browser_run'}]) assert.equal(prepare(part),undefined);
  const first=prepare({type:'tool-input-start',toolName:'browser_run'});
  assert.equal(prepare({type:'tool-input-start',toolName:'browser_open'}),first);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  finish();await first;
});

test('browser preparation respects cancellation and lost execution ownership',async()=>{
  let calls=0;const controller=new AbortController();controller.abort();
  await createBrowserPreparation(async()=>{calls++},controller.signal)({type:'tool-input-start',toolName:'browser_run'});
  const later=new AbortController();const pending=createBrowserPreparation(async()=>{calls++},later.signal)({type:'tool-input-start',toolName:'browser_run'});later.abort();await pending;
  await withExecutionOwnership(async()=>{throw new Error('lost ownership')},async()=>{
    await createBrowserPreparation(async()=>{calls++})({type:'tool-input-start',toolName:'browser_run'});
  });
  assert.equal(calls,0);
});

test('optional preparation failures do not reject the model stream',async()=>{
  await createBrowserPreparation(async()=>{throw new Error('temporary setup failure')})({type:'tool-input-start',toolName:'browser_run'});
});
