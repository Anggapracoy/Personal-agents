import assert from 'node:assert/strict';
import test from 'node:test';
import { transferSignInSession } from '../lib/harness/signin-handoff';

test('successful session import stays successful when redirect destroys the page context', async () => {
  let imports=0,observations=0;
  const result=await transferSignInSession(async()=>{imports++;},async()=>{observations++;throw new Error('Cannot find context with specified id');},async()=>{});
  assert.deepEqual(result,{sessionTransferred:true,observationPending:true});
  assert.equal(imports,1);assert.equal(observations,1);
});
test('failed session import is not hidden or mislabeled as shared', async () => {
  let observed=false;
  await assert.rejects(transferSignInSession(async()=>{throw new Error('Import failed');},async()=>{observed=true;},async()=>{}),/Import failed/);
  assert.equal(observed,false);
});
test('successful page observation remains available to the agent', async () => {
  assert.deepEqual(await transferSignInSession(async()=>{},async()=>({title:'Dashboard'}),async()=>{}),{sessionTransferred:true,observationPending:false,page:{title:'Dashboard'}});
});


test('phone sign-in waits for takeover release before importing cookies', async () => {
  let controlled = true;
  const order: string[] = [];
  const result = await transferSignInSession(async () => {
    if (controlled) throw new Error('The user is controlling this browser. Wait until they choose Continue.');
    order.push('import');
  }, async () => { order.push('observe'); return 'signed-in page'; }, async () => {
    order.push('release-start');
    await new Promise(resolve => setTimeout(resolve, 10));
    controlled = false;
    order.push('release-finished');
  });
  assert.deepEqual(order, ['release-start', 'release-finished', 'import', 'observe']);
  assert.equal(result.sessionTransferred, true);
});

test('failed takeover release does not import cookies into a user-controlled browser', async () => {
  await assert.rejects(transferSignInSession(
    async () => { assert.fail('must not import'); },
    async () => { assert.fail('must not observe'); },
    async () => { throw new Error('Takeover release failed'); },
  ), /Takeover release failed/);
});

test('expired browser release allows cookie import to create a fresh signed-in session', async () => {
  const order: string[] = [];
  const result = await transferSignInSession(
    async () => { order.push('import into fresh browser'); },
    async () => { order.push('open login URL'); return 'signed-in page'; },
    async () => { order.push('release expired browser'); throw new Error('Browser session is not running. Saved logins may be restored.'); },
  );
  assert.deepEqual(order, ['release expired browser', 'import into fresh browser', 'open login URL']);
  assert.deepEqual(result, { sessionTransferred: true, observationPending: false, page: 'signed-in page' });
});

test('cookie import failure after browser expiry still fails the handoff', async () => {
  await assert.rejects(transferSignInSession(
    async () => { throw new Error('Fresh browser unavailable'); },
    async () => { assert.fail('must not observe'); },
    async () => { throw new Error('Browser session is not running.'); },
  ), /Fresh browser unavailable/);
});
