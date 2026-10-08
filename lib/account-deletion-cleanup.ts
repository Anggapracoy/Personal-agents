import { removeLocalAccount } from "./auth/accounts";
import { randomUUID } from 'node:crypto';
import { securityDatabase } from './security-store';
import { decryptSecret, encryptSecret } from './harness/secrets';
import { closeCloudBrowser } from './harness/browser/registry';
import { composioClient, ownedAccounts } from './composio/service';

export type DeletionCleanup = {
  googleTokens: string[];
  composioSessionIds: string[];
  composio: boolean;
  browser: boolean;
  localAccount: boolean;
};

async function cleanupGoogle(tokens: string[]) {
  const deadline = AbortSignal.timeout(120_000);
  for (const encrypted of tokens) {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decryptSecret(encrypted) }), signal: AbortSignal.any([deadline, AbortSignal.timeout(8_000)]),
    });
    const body = response.ok ? null : await response.json().catch(() => null);
    if (!response.ok && !(response.status === 400 && body?.error === 'invalid_token')) throw new Error('Google revocation is pending.');
  }
}

async function cleanupComposio(owner: string, sessions: string[]) {
  const options = { signal: AbortSignal.timeout(120_000) };
  for (const account of await ownedAccounts(owner, options)) await composioClient().connectedAccounts.delete(account.id, options);
  for (const id of sessions) {
    try { await composioClient().sessions.delete(id, options); }
    catch (error) { if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error; }
  }
}

async function cleanupBrowser(owner: string) {
  if (!process.env.E2B_API_KEY || !process.env.BROWSERLESS_API_TOKEN) throw new Error('Restore browser provider configuration to finish deletion.');
  await closeCloudBrowser(owner);
}

export const deletionCleanupDependencies = { google: cleanupGoogle, composio: cleanupComposio, browser: cleanupBrowser, localAccount: removeLocalAccount };

/** A lease prevents simultaneous deletion requests/workers from racing cleanup. */
export async function finishAccountDeletion(owner: string, dependencies = deletionCleanupDependencies) {
  const db = securityDatabase();
  if (!db) throw new Error('Persistent deletion storage is required.');
  const lease = randomUUID();
  const [job] = await db`update account_deletion_jobs set lease_token=${lease}, lease_until=now()+interval '5 minutes', attempts=attempts+1
    where owner_email=${owner} and (lease_until is null or lease_until<now()) returning encrypted_payload`;
  if (!job) return !(await db`select 1 from account_deletion_jobs where owner_email=${owner}`).length;
  const payload = JSON.parse(decryptSecret(job.encrypted_payload)) as DeletionCleanup;
  const results = await Promise.allSettled([
    payload.googleTokens.length ? dependencies.google(payload.googleTokens) : Promise.resolve(),
    payload.composio ? dependencies.composio(owner, payload.composioSessionIds) : Promise.resolve(),
    payload.browser ? dependencies.browser(owner) : Promise.resolve(),
    payload.localAccount ? dependencies.localAccount(owner) : Promise.resolve(),
  ]);
  if (results[0].status === 'fulfilled') payload.googleTokens = [];
  if (results[1].status === 'fulfilled') { payload.composio = false; payload.composioSessionIds = []; }
  if (results[2].status === 'fulfilled') payload.browser = false;
  if (results[3].status === 'fulfilled') payload.localAccount = false;
  const complete = !payload.googleTokens.length && !payload.composio && !payload.browser && !payload.localAccount;
  await db.begin(async tx => {
    if (complete) {
      const removed = await tx`delete from account_deletion_jobs where owner_email=${owner} and lease_token=${lease} returning owner_email`;
      if (removed.length) await tx`delete from auth_revocations where key=${`deleting:${owner}`}`;
    } else await tx`update account_deletion_jobs set encrypted_payload=${encryptSecret(JSON.stringify(payload))},
      lease_token=null, lease_until=null, next_attempt_at=now()+interval '5 minutes' where owner_email=${owner} and lease_token=${lease}`;
  });
  return complete;
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
