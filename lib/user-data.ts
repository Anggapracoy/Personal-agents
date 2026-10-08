import { removeAllConnectorAccounts } from "./composio/service";

import postgres from "postgres";
import { removeLocalAccount } from "./auth/accounts";
import { removeAllGoogleConnections } from "./auth/google-connections";
import { closeCloudBrowser } from "./harness/browser/registry";
import { deleteMemoryRunsForUser } from "./harness/store";
import { revokeUserSessions } from "./auth/session-revocation";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export type UserDataDeletionResult = {
  deletedAccount: boolean;
  disconnectedGoogleAccounts: number;
};

export async function deleteUserData(ownerEmailInput: string, options: { deleteAccount: boolean }): Promise<UserDataDeletionResult> {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  // Invalidate every previously issued token, including other devices and pending handoffs.
  if (options.deleteAccount) await revokeUserSessions(ownerEmail);
  await removeAllConnectorAccounts(ownerEmail);
  const disconnectedGoogleAccounts = await removeAllGoogleConnections(ownerEmail);
  await closeCloudBrowser(ownerEmail);
  deleteMemoryRunsForUser(ownerEmail);

  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { prepare: false });
    try {
      await sql.begin(async (transaction) => {
        // Stop durable work before cascading the run records away. Any local
        // worker still holding a run will observe that it no longer exists.
        await transaction`update agent_runs set status = 'cancelled', completed_at = now(), updated_at = now() where lower(user_id) = ${ownerEmail} and status not in ('done', 'failed', 'cancelled')`;
        await transaction`delete from agent_runs where lower(user_id) = ${ownerEmail}`;

        await transaction`delete from google_source_watches where lower(owner_email) = ${ownerEmail}`;
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
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  if (options.deleteAccount) await removeLocalAccount(ownerEmail).catch(() => undefined);
  return { deletedAccount: options.deleteAccount, disconnectedGoogleAccounts };
}
