import type { RunStore } from './types';
export const STALE_WORKER_MS = 5 * 60_000;

/** The database lock, not the status label, decides whether an execution can be recovered. */
export async function recoverRun(store: RunStore, runId: string, dispatch: (id: string, eventId: string) => Promise<unknown>, now = Date.now()) {
  const locked = await store.withExecutionLock(runId, async () => {
    const run = await store.getRun(runId);
    if (!run || !['planning', 'running'].includes(run.status)) return false;
    const heartbeat = Number(run.metadata.workerHeartbeatAt ?? Date.parse(run.updatedAt));
    if (heartbeat > now - STALE_WORKER_MS || Number(run.metadata.workerRecoveryAt ?? 0) > now - STALE_WORKER_MS) return false;
    if (run.metadata.runPreparationPending === true) {
      await store.updateRun(runId, { status: 'failed', error: 'Your request could not be prepared. Please try again.', completedAt: new Date(now).toISOString() });
      return false;
    }
    // Claim first, so cron and failure callbacks cannot enqueue duplicate recovery.
    await store.updateRunMetadata(runId, { workerRecoveryAt: now });
    try { await dispatch(runId, `recover:${runId}:${heartbeat}`); }
    catch (error) { await store.updateRunMetadata(runId, { workerRecoveryAt: null }); throw error; }
    return true;
  });
  return locked.acquired && locked.value;
}
