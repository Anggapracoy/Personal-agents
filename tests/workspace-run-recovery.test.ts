import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverWorkspaceRuns } from '../lib/workspace-run-recovery';
import type { RecoverableRun } from '../lib/workspace-run-recovery';
import type { WorkspaceStateData } from '../lib/types';
const empty: WorkspaceStateData = { decisions: [], tasks: [], history: [], discardedDecisionIds: [] };
const run = { id: 'f2a16b1e-d230-4299-acdb-2738ab09a311', decisionId: 'message-lost', category: 'social', title: 'Report streetlight', request: 'Report the flickering streetlight', status: 'awaiting_approval', metadata: { sourceType: 'manual' }, updatedAt: '2026-10-04T02:14:42.417Z', pendingAction: { id: 'device-location', toolName: 'apple_device', preview: 'Get your location', input: { operation: 'location.current', parameters: {} } } } satisfies RecoverableRun;
test('a lost client save recovers the waiting location action ready for the app runner', () => {
  const state = recoverWorkspaceRuns(empty, [run]);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].runId, run.id);
  assert.equal(state.tasks[0].actionId, 'device-location');
  assert.deepEqual(state.tasks[0].nativeAction, { operation: 'location.current', parameters: {}, readOnly: true });
  assert.equal(state.tasks[0].status, 'waiting');
  assert.equal(recoverWorkspaceRuns(state, [run]), state);
});
test('recovery does not duplicate a history entry, decision, or intentionally discarded chat', () => {
  for (const state of [ { ...empty, history: [{ runId: run.id }] }, { ...empty, decisions: [{ activeRunId: run.id }] }, { ...empty, discardedDecisionIds: [run.decisionId!] } ]) {
    assert.equal(recoverWorkspaceRuns(state as WorkspaceStateData, [run]), state);
  }
});

test('server publication is atomic, owner-scoped and idempotent without replacing existing workspace preferences', async () => {
  const { publishCreatedRun } = await import('../lib/workspace-state');
  const { PgDialect } = await import('drizzle-orm/pg-core');
  let query: { sql: string; params: unknown[] } | undefined;
  const db = { execute: async (statement: any) => { query = new PgDialect().sqlToQuery(statement); return []; } };
  await publishCreatedRun({ ...run, userId: ' Owner@Test.Invalid ' } as any, db as any);
  assert.match(query!.sql, /on conflict\(owner_email\) do update/);
  assert.match(query!.sql, /version=workspace_states.version\+1/);
  assert.match(query!.sql, /where not exists/);
  assert.doesNotMatch(query!.sql.split('do update')[1], /preferences_json=/);
  assert.ok(query!.params.includes('owner@test.invalid'));
  const published = query!.params.find(value => typeof value === 'string' && value.includes('remote-f2a16b1e')) as string;
  assert.equal(JSON.parse(published).tasks[0].runId, run.id);
});

test('recovered questions remain subscribed for their complete snapshot', () => {
  const state = recoverWorkspaceRuns(empty, [{ ...run, status: 'paused', pendingAction: null }]);
  assert.equal(state.tasks[0].status, 'running');
});

test('recovery never executes an interrupted request with unfinished attachments', async () => {
  const { MemoryRunStore } = await import('../lib/harness/store');
  const { recoverRun, STALE_WORKER_MS } = await import('../lib/harness/recovery');
  const store = new MemoryRunStore();
  const pending = await store.createRun({ userId: 'prepare@test.invalid', decisionId: null, category: 'social', title: 'Photo', request: 'Read this photo', metadata: { runPreparationPending: true } });
  let dispatched = false;
  assert.equal(await recoverRun(store, pending.id, async () => { dispatched = true; }, Date.now() + STALE_WORKER_MS + 1000), false);
  assert.equal(dispatched, false);
  assert.equal((await store.getRun(pending.id))?.status, 'failed');
});

test('an unpublished chat can be recovered after quick completion without a prior workspace', () => {
  const completed = { ...run, status: 'done' as const, pendingAction: null, metadata: { sourceType: 'manual', workspacePublicationPending: true } };
  const state = recoverWorkspaceRuns(empty, [completed]);
  assert.equal(state.tasks[0].runId, run.id);
  assert.equal(state.tasks[0].status, 'running'); // subscribes once for the terminal snapshot/history
});

test('stopped unpublished chats never return while failed and completed ones remain recoverable', () => {
  const unpublished = { ...run, metadata: { workspacePublicationPending: true } };
  assert.equal(recoverWorkspaceRuns(empty, [{ ...unpublished, status: 'cancelled' }]), empty);
  assert.equal(recoverWorkspaceRuns(empty, [{ ...unpublished, status: 'failed' }]).tasks.length, 1);
});
