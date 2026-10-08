/** Coalesce redundant control-plane calls while retaining a full idle lease. */
const renewEveryMs = 30_000;
const leases = new WeakMap<object, { renewedAt: number; pending?: Promise<void> }>();
export async function keepControllerAlive(sandbox: { setTimeout: (milliseconds: number) => Promise<unknown> }, idleMs: number, now = performance.now()): Promise<void> {
  const lease = leases.get(sandbox) ?? { renewedAt: -Infinity };
  leases.set(sandbox, lease);
  if (lease.pending) return lease.pending;
  if (now - lease.renewedAt < renewEveryMs) return;
  lease.pending = (async () => {
    // The margin means skipped refreshes never shorten the requested idle window.
    await sandbox.setTimeout(idleMs + renewEveryMs);
    lease.renewedAt = now;
  })();
  try { await lease.pending; }
  finally { lease.pending = undefined; }
}
