import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { iCloudSecret, recordICloudCheck, listICloudAccounts, assertCurrentICloudAccount } from './icloud-store';
import { readICloudInbox } from './icloud-client';
import { getWorkspaceState } from '../workspace-state';
import { getLifeProfile } from '../life-profile';
import { existingDecisionContextFromWorkspace } from '../discovery/existing-decisions';
import { discoverDecisionCards } from '../discovery/harness';
import { mergeDiscoveredDecisions } from '../discovery/google-push-worker';
import { getDiscoveryScanState, rememberReviewedMessages } from '../discovery/scan-state';
import type { Decision } from '../types';

export async function scanICloudAccount(owner: string, id: string, force = false) {
  const account = await iCloudSecret(owner, id);
  try {
    const key = `${owner}:icloud:${id}`;
    const previous = await getDiscoveryScanState(key);
    const reviewed = new Set(force ? [] : previous?.reviewedMessageIds ?? []);
    const [fresh, workspace, lifeMemory] = await Promise.all([
      readICloudInbox(account.email, account.password, id, 100, undefined, reviewed), getWorkspaceState(owner), getLifeProfile(owner),
    ]);
    await assertCurrentICloudAccount(owner, id, account.revision);
    const emails = [...fresh, ...(previous?.recentEmails ?? []).filter(email => !fresh.some(item => item.id === email.id))].slice(0, 150);
    const sourced = (decision: Decision): Decision => ({ ...decision, id: `icloud-${id}-${decision.id}`, sourceLabel: account.email,
      executionContext: { ...decision.executionContext, sourceAccountId: id, sourceAccountEmail: account.email, emailProvider: 'icloud' } });
    let saved = Promise.resolve();
    const report = fresh.length ? await discoverDecisionCards({ userId: key, accessToken: '', emails: fresh,
      evidenceEmails: emails, events: [], existingDecisions: existingDecisionContextFromWorkspace(workspace.state), lifeMemory,
      userTimeZone: lifeMemory.profile?.timeZone ?? 'UTC',
      emailReader: async messageId => { const email = emails.find(item => item.id === messageId); if (!email) throw new Error('This iCloud message is not in the current mailbox evidence.'); return email; },
      emailSearcher: async (query, limit) => { const terms = query.toLowerCase().replace(/\b(from|subject):/g, '').split(/\s+/).filter(Boolean); return emails.filter(email => terms.every(term => `${email.from} ${email.subject} ${email.body}`.toLowerCase().includes(term))).slice(0, limit); },
      onDecision: decision => { saved = saved.then(async () => { await assertCurrentICloudAccount(owner, id, account.revision); await mergeDiscoveredDecisions(owner, [sourced(decision)]); }); },
    }) : null;
    await saved;
    if (report) {
      await assertCurrentICloudAccount(owner, id, account.revision);
      await mergeDiscoveredDecisions(owner, report.decisions.map(sourced));
      await rememberReviewedMessages(key, report.reviewedEmailIds.filter(messageId => !report.failedEmailIds.includes(messageId)), emails, 'icloud');
    }
    await recordICloudCheck(owner, id, undefined, account.revision);
    return { scannedEmailCount: fresh.length, analyzedEmailCount: fresh.length, decisionCount: report?.decisions.length ?? 0 };
  } catch (error) { await recordICloudCheck(owner, id, error, account.revision); throw error; }
}
export async function scanConnectedICloud(owner: string, force = false) {
  const allAccounts = (await listICloudAccounts(owner)).filter(account => account.enabled);
  const accounts = allAccounts.filter(account => !account.needsReconnect);
  const results = [], warnings: string[] = allAccounts.filter(account => account.needsReconnect).map(account => `Reconnect iCloud Mail for ${account.email} in Connected apps.`);
  for (const account of accounts) {
    try { results.push(await scanICloudAccount(owner, account.id, force)); }
    catch { warnings.push(`iCloud Mail for ${account.email} could not be checked. Check its connection in Connected apps.`); }
  }
  return { results, warnings, accountCount: allAccounts.length };
}
export async function dueICloudAccounts() {
  return getDb().execute<{ ownerEmail: string; accountId: string }>(sql`select owner_email as "ownerEmail",id as "accountId" from connected_icloud_mail_accounts where enabled=true and reconnect_required_at is null and (last_checked_at is null or last_checked_at<now()-interval '15 minutes') order by last_checked_at nulls first limit 50`);
}
