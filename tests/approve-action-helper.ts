import assert from 'node:assert/strict';
import { ApprovalRequiredError } from '../lib/harness/actions';
import type { RunStore } from '../lib/harness/types';

/** Simulate the user's exact-action approval, leaving provider behavior under test. */
export async function approveAndRetry<T>(store: RunStore, runId: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof ApprovalRequiredError)) throw error;
    const run = await store.getRun(runId);
    assert.ok(run);
    assert.equal(error.action.runId, runId);
    assert.ok(await store.approveAction(error.action.id, runId, run.userId));
    await store.updateRun(runId, { status: 'running' });
    return operation();
  }
}
