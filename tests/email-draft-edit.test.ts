import test from 'node:test';
import assert from 'node:assert/strict';
import { editedDraftRaw, emailDraftEditSchema } from '../lib/harness/email-draft-edit';
import { MemoryRunStore } from '../lib/harness/store';
import { createGoogleToolRegistry } from '../lib/harness/google-tools';
import { ApprovalRequiredError } from '../lib/harness/actions';

const originalRaw = Buffer.from('To: recipient@example.com\r\nCc: copy@example.com\r\nSubject: Old\r\nIn-Reply-To: <source@example.com>\r\nReferences: <older@example.com>\r\n <source@example.com>\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nOld body').toString('base64url');
const edit = { subject: 'Updated café', body: 'Hi,\n\nTuesday works. Thanks!\nMichael' };
test('inline draft edits preserve routing and threading, and validate headers and MIME', () => {
  const raw = Buffer.from(editedDraftRaw(originalRaw, edit), 'base64url').toString();
  assert.match(raw, /To: recipient@example.com/); assert.match(raw, /Cc: copy@example.com/);
  assert.match(raw, /In-Reply-To: <source@example.com>/);
  assert.match(raw, /References: <older@example.com> <source@example.com>/);
  assert.equal(Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString(), edit.body);
  assert.ok(raw.includes(Buffer.from(edit.subject).toString('base64')));
  assert.equal(emailDraftEditSchema.safeParse({ ...edit, subject: 'Hello\r\nBcc: bad@example.com' }).success, false);
  assert.equal(emailDraftEditSchema.safeParse({ ...edit, body: '  ' }).success, false);
  assert.throws(() => editedDraftRaw(Buffer.from('Content-Type: multipart/mixed\r\n\r\nattachment').toString('base64url'), edit), /Nothing was sent/);
});

test('approved edits update the Gmail draft before sending once; a failed update never sends', async () => {
  for (const failUpdate of [false, true]) {
    const store = new MemoryRunStore();
    const run = await store.createRun({ userId: 'inline@test.invalid', decisionId: null, category: 'social', request: 'Reply', title: 'Reply', metadata: {} });
    await store.updateRun(run.id, { status: 'running' });
    await store.putSecret(run.id, 'google_access_token', 'test-only');
    const fetchBefore = globalThis.fetch;
    const calls: Array<{url: string; init?: RequestInit}> = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({url: String(url), init});
      if (init?.method === 'PUT' && failUpdate) return new Response(JSON.stringify({ error: { message: 'Update refused' } }), {status: 400});
      return new Response(JSON.stringify(init?.method === 'POST' ? {id: 'sent'} : {id: 'draft', message: {raw: originalRaw, threadId: 'thread'}}), {status: 200});
    }) as typeof fetch;
    try {
      const registry = await createGoogleToolRegistry({runId: run.id, stepId: 'step', store});
      const tool = registry.tools.gmail_send_draft as unknown as {execute(args: Record<string, unknown>, options: object): Promise<unknown>};
      const args = {draftId: 'draft', to: ['recipient@example.com'], subject: 'Old', body: 'Old body'};
      await assert.rejects(() => tool.execute(args, {}), ApprovalRequiredError);
      assert.equal(calls.length, 0);
      const action = (await store.getSnapshot(run.id))!.actions[0];
      assert.equal(await store.approveAction(action.id, 'wrong-run', run.userId, edit), null);
      await store.approveAction(action.id, run.id, run.userId, edit);
      assert.equal(await store.approveAction(action.id, run.id, run.userId, { ...edit, body: 'late change' }), null);
      await store.updateRun(run.id, {status: 'running'});
      if (failUpdate) await assert.rejects(() => tool.execute(args, {}), /Update refused/);
      else { await tool.execute(args, {}); await tool.execute(args, {}); }
      assert.deepEqual(calls.map(call => call.init?.method ?? 'GET'), failUpdate ? ['GET', 'PUT'] : ['GET', 'PUT', 'POST']);
      const update = JSON.parse(String(calls[1].init?.body));
      assert.equal(update.message.threadId, 'thread');
      const raw = Buffer.from(update.message.raw, 'base64url').toString();
      assert.equal(Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString(), edit.body);
    } finally { globalThis.fetch = fetchBefore; }
  }
});

test('Postgres approval atomically retains the winning edit and rejects stale or unrelated approvals', {skip: !process.env.SCHEDULE_TEST_DATABASE_URL}, async () => {
  const {default: postgres} = await import('postgres');
  const {PostgresRunStore} = await import('../lib/harness/store');
  const url = process.env.SCHEDULE_TEST_DATABASE_URL!;
  const admin = postgres(url, {onnotice: () => {}});
  const schema = `email_edit_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin.unsafe(`create schema ${schema}`);
  const sql = postgres(url, {prepare: false, connection: {search_path: schema}, onnotice: () => {}});
  try {
    await sql`create table agent_actions(id text primary key, run_id text, tool_name text, status text, input jsonb, result jsonb, approved_by text, approved_at timestamptz)`;
    await sql`insert into agent_actions values ('action', 'run', 'gmail_send_draft', 'proposed', '{}'::jsonb, null, null, null)`;
    const store = new PostgresRunStore(url, sql);
    assert.equal(await store.approveAction('action', 'other', 'owner', edit), null);
    const results = await Promise.all([store.approveAction('action', 'run', 'owner', edit), store.approveAction('action', 'run', 'owner', {...edit, body: 'Other edit'})]);
    assert.equal(results.filter(Boolean).length, 1);
    const saved = await store.getAction('action', 'run');
    assert.deepEqual(saved?.result?.approvedEmailEdit, results.find(Boolean)?.result?.approvedEmailEdit);
    await sql`insert into agent_actions values ('purchase', 'run', 'browser_click', 'proposed', '{}'::jsonb, null, null, null)`;
    assert.equal(await store.approveAction('purchase', 'run', 'owner', edit), null);
    assert.equal((await store.approveAction('purchase', 'run', 'owner'))?.status, 'approved');
  } finally {await sql.end(); await admin.unsafe(`drop schema ${schema} cascade`); await admin.end();}
});
