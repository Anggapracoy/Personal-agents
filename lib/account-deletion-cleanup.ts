import { removeLocalAccount } from "./auth/accounts";
import { randomUUID } from 'node:crypto';
import { securityDatabase } from './security-store';
import { decryptSecret, encryptSecret } from './harness/secrets';
import { closeCloudBrowser } from './harness/browser/registry';
import { composioClient, ownedAccounts } from './composio/service';
import { assertCleanupActive, type CleanupControl } from './cleanup-control';

export type DeletionCleanup = {
  googleTokens: string[];
  composioSessionIds: string[];
  composio: boolean;
  browser: boolean;
  localAccount: boolean;
};

async function cleanupGoogle(tokens: string[], control: CleanupControl) {
  for (const encrypted of tokens) {
    await assertCleanupActive(control);
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decryptSecret(encrypted) }), signal: AbortSignal.any([control.signal, AbortSignal.timeout(8_000)]),
    });
    const body = response.ok ? null : await response.json().catch(() => null);
    if (!response.ok && !(response.status === 400 && body?.error === 'invalid_token')) throw new Error('Google revocation is pending.');
  }
}

async function cleanupComposio(owner: string, sessions: string[], control: CleanupControl) {
  const options = { signal: control.signal };
  for (const account of await ownedAccounts(owner, options)) {
    await assertCleanupActive(control);
    await composioClient().connectedAccounts.delete(account.id, options);
  }
  for (const id of sessions) {
    await assertCleanupActive(control);
    try { await composioClient().sessions.delete(id, options); }
    catch (error) { if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error; }
  }
}

async function cleanupBrowser(owner: string, control: CleanupControl) {
  if (!process.env.E2B_API_KEY || !process.env.BROWSERLESS_API_TOKEN) throw new Error('Restore browser provider configuration to finish deletion.');
  await closeCloudBrowser(owner, control);
}

async function cleanupLocalAccount(owner: string, control: CleanupControl) {
  await assertCleanupActive(control);
  await removeLocalAccount(owner);
}
export const deletionCleanupDependencies = { google: cleanupGoogle, composio: cleanupComposio, browser: cleanupBrowser, localAccount: cleanupLocalAccount };

/** A lease prevents simultaneous deletion requests/workers from racing cleanup. */
export async function finishAccountDeletion(owner: string, dependencies = deletionCleanupDependencies, options: { deadlineMs?: number; signal?: AbortSignal } = {}) {
  const db = securityDatabase();
  if (!db) throw new Error('Persistent deletion storage is required.');
  const lease = randomUUID();
  const [job] = await db`update account_deletion_jobs set lease_token=${lease}, lease_until=now()+interval '5 minutes', attempts=attempts+1
    where owner_email=${owner} and (lease_until is null or lease_until<now()) returning encrypted_payload`;
  if (!job) return !(await db`select 1 from account_deletion_jobs where owner_email=${owner}`).length;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('Deletion cleanup deadline exceeded.')), Math.min(120_000, Math.max(1, options.deadlineMs ?? 120_000)));
  const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
  const control: CleanupControl = { signal, assertOwned: async () => {
    signal.throwIfAborted();
    const [owned] = await db`select 1 from account_deletion_jobs where owner_email=${owner} and lease_token=${lease} and lease_until>now()`;
    if (!owned) { abort.abort(new Error('Deletion cleanup ownership changed.')); abort.signal.throwIfAborted(); }
  } };
  const invoke = async (action: () => Promise<unknown>) => {
    await assertCleanupActive(control);
    let stop: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
    try { await Promise.race([action(), cancelled]); }
    finally { if (stop) signal.removeEventListener('abort', stop); }
  };
  try {
    const payload = JSON.parse(decryptSecret(job.encrypted_payload)) as DeletionCleanup;
    const results = await Promise.allSettled([
      payload.googleTokens.length ? invoke(() => dependencies.google(payload.googleTokens, control)) : Promise.resolve(),
      payload.composio ? invoke(() => dependencies.composio(owner, payload.composioSessionIds, control)) : Promise.resolve(),
      payload.browser ? invoke(() => dependencies.browser(owner, control)) : Promise.resolve(),
      payload.localAccount ? invoke(() => dependencies.localAccount(owner, control)) : Promise.resolve(),
    ]);
    if (results[0].status === 'fulfilled') payload.googleTokens = [];
    if (results[1].status === 'fulfilled') { payload.composio = false; payload.composioSessionIds = []; }
    if (results[2].status === 'fulfilled') payload.browser = false;
    if (results[3].status === 'fulfilled') payload.localAccount = false;
    const complete = !signal.aborted && !payload.googleTokens.length && !payload.composio && !payload.browser && !payload.localAccount;
    await db.begin(async tx => {
      if (complete) {
        const removed = await tx`delete from account_deletion_jobs where owner_email=${owner} and lease_token=${lease} and lease_until>now() returning owner_email`;
        if (removed.length) await tx`delete from auth_revocations where key=${`deleting:${owner}`}`;
      } else await tx`update account_deletion_jobs set encrypted_payload=${encryptSecret(JSON.stringify(payload))},
        lease_token=null, lease_until=null, next_attempt_at=now()+interval '5 minutes' where owner_email=${owner} and lease_token=${lease}`;
    });
    return complete && !(await db`select 1 from account_deletion_jobs where owner_email=${owner}`).length;
  } catch {
    // Malformed/old-key jobs remain retryable without starving later jobs.
    await db`update account_deletion_jobs set lease_token=null,lease_until=null,next_attempt_at=now()+interval '5 minutes' where owner_email=${owner} and lease_token=${lease}`;
    return false;
  } finally { clearTimeout(timer); abort.abort(new Error('Deletion cleanup attempt finished.')); }
}

export async function retryAccountDeletions() {
  const db = securityDatabase();
  if (!db) return { checked: 0, completed: 0 };
  const jobs = await db`select owner_email from account_deletion_jobs where next_attempt_at<=now()
    and (lease_until is null or lease_until<now()) order by created_at limit 10`;
  let completed = 0;
  for (const job of jobs) if (await finishAccountDeletion(job.owner_email)) completed++;
  return { checked: jobs.length, completed };
}
