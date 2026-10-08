import { finishAccountDeletion, type DeletionCleanup } from "./account-deletion-cleanup";
import { encryptSecret } from "./harness/secrets";

import postgres from "postgres";
import { deleteMemoryRunsForUser } from "./harness/store";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export type UserDataDeletionResult = {
  deletedAccount: boolean;
  disconnectedGoogleAccounts: number;
  cleanupPending: boolean;
};

export async function deleteUserData(ownerEmailInput: string, options: { deleteAccount: boolean }, finish = finishAccountDeletion): Promise<UserDataDeletionResult> {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  if (!process.env.DATABASE_URL) throw new Error("Persistent deletion storage is required.");
  let disconnectedGoogleAccounts = 0;
  {
    const sql = postgres(process.env.DATABASE_URL, { prepare: false });
    try {
      await sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext(${ownerEmail}))`;
        // Do not replace retry credentials from an earlier incomplete deletion.
        if ((await transaction`select 1 from account_deletion_jobs where owner_email=${ownerEmail}`).length) throw new Error("A deletion is already being completed. Retry after cleanup finishes.");
        const google = await transaction`select encrypted_refresh_token, encrypted_access_token from connected_google_accounts where lower(owner_email)=${ownerEmail}`;
        const legacyGoogle = await transaction`select google_refresh_token,google_access_token from users where lower(email)=${ownerEmail}`;
        const browserHistory = await transaction`select 1 from agent_runs where lower(user_id)=${ownerEmail} and metadata->>'browserUsed'='true' limit 1`;
        const composio = await transaction`select session_id, runtime_session_id from composio_sessions where lower(owner_email)=${ownerEmail}`;
        disconnectedGoogleAccounts = google.length;
        const cleanup: DeletionCleanup = {
          googleTokens: [...google.map(row => row.encrypted_refresh_token || row.encrypted_access_token),
            ...legacyGoogle.flatMap(row => row.google_refresh_token || row.google_access_token ? [encryptSecret(row.google_refresh_token || row.google_access_token)] : [])],
          composioSessionIds: composio.flatMap(row => [row.session_id, row.runtime_session_id].filter(Boolean)),
          composio: composio.length > 0,
          browser: Boolean((process.env.E2B_API_KEY && process.env.BROWSERLESS_API_TOKEN) || browserHistory.length),
          localAccount: options.deleteAccount,
        };
        await transaction`insert into account_deletion_jobs(owner_email,encrypted_payload) values (${ownerEmail},${encryptSecret(JSON.stringify(cleanup))})`;
        await transaction`insert into auth_revocations(key,revoked_at) values (${`deleting:${ownerEmail}`},${Date.now()}) on conflict(key) do update set revoked_at=excluded.revoked_at`;
        if (options.deleteAccount) await transaction`insert into auth_revocations(key,revoked_at) values (${`owner:${ownerEmail}`},${Date.now()}) on conflict(key) do update set revoked_at=greatest(auth_revocations.revoked_at,excluded.revoked_at)`;
        // Stop durable work before cascading the run records away. Any local
        // worker still holding a run will observe that it no longer exists.
        await transaction`update agent_runs set status = 'cancelled', completed_at = now(), updated_at = now() where lower(user_id) = ${ownerEmail} and status not in ('done', 'failed', 'cancelled')`;
        await transaction`delete from agent_runs where lower(user_id) = ${ownerEmail}`;

        await transaction`delete from google_source_watches where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from composio_sessions where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from connected_icloud_mail_accounts where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from connected_google_accounts where lower(owner_email) = ${ownerEmail}`;
        // Scan keys are the email itself or email:connection-id. LIKE would
        // treat legal email characters such as '_' and '%' as wildcards.
        await transaction`delete from discovery_scan_states where lower(user_key) = ${ownerEmail} or left(lower(user_key), length(${ownerEmail}) + 1) = ${`${ownerEmail}:`}`;
        await transaction`delete from manual_scan_jobs where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from push_notification_jobs where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from push_device_tokens where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from shared_intakes where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from morning_idea_runs where lower(owner_email) = ${ownerEmail}`;
        // Post-deployment migration 0031 may already have removed these tables.
        for (const table of ["proactive_moments", "proactive_deliveries"] as const) {
          const [exists] = await transaction`select to_regclass(${`public.${table}`}) as name`;
          if (exists.name) await transaction`delete from ${transaction(table)} where lower(owner_email)=${ownerEmail}`;
        }
        await transaction`delete from waitlist_entries where lower(email)=${ownerEmail}`;
        await transaction`delete from proactive_candidates where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from proactive_preferences where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from proactive_eta_checks where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from proactive_opportunities where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from proactive_opportunity_sources where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from proactive_opportunity_refreshes where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from consumer_vault_items where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from agent_approval_preferences where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from life_facts where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from user_profile_photos where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from user_life_profiles where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from workspace_states where lower(owner_email) = ${ownerEmail}`;
        await transaction`delete from mobile_user_states where lower(owner_email) = ${ownerEmail}`;

        // These legacy relational records predate the email-keyed workspace.
        // Delete children explicitly because their original foreign keys do
        // not cascade from users.
        await transaction`delete from history where user_id in (select id from users where lower(email) = ${ownerEmail})`;
        await transaction`delete from running_tasks where user_id in (select id from users where lower(email) = ${ownerEmail})`;
        await transaction`delete from decisions where user_id in (select id from users where lower(email) = ${ownerEmail})`;
        if (options.deleteAccount) await transaction`delete from users where lower(email) = ${ownerEmail}`;
        else await transaction`update users set google_access_token=null, google_refresh_token=null,
          location_lat=null, location_lng=null, preferences_json='{}'::jsonb, last_scan_at=null where lower(email)=${ownerEmail}`;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  deleteMemoryRunsForUser(ownerEmail);
  // Durable cleanup can be retried even if the request/server dies here.
  const complete = await finish(ownerEmail).catch(() => false);
  return { deletedAccount: options.deleteAccount, disconnectedGoogleAccounts, cleanupPending: !complete };
}
