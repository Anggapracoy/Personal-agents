import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { RunStore } from '../harness/types';
import { executeGuardedAction } from '../harness/actions';
import { emailDraftEditSchema } from '../harness/email-draft-edit';
import { listICloudAccounts, iCloudSecret, recordICloudCheck } from './icloud-store';
import { readICloudInbox, readICloudMessage, sendICloudMessage } from './icloud-client';
const defaultServices = { listICloudAccounts, iCloudSecret, recordICloudCheck, readICloudInbox, readICloudMessage, sendICloudMessage };
export async function createICloudTools(input: { userId: string; runId: string; stepId: string; store: RunStore; signal?: AbortSignal; services?: typeof defaultServices }): Promise<ToolSet> {
  const services = input.services ?? defaultServices;
  if (!process.env.DATABASE_URL && !input.services) return {};
  const accounts = await services.listICloudAccounts(input.userId);
  if (!accounts.length) return {} as ToolSet;
  const accountSchema = z.object({ accountId: z.string().uuid() });
  const emails = async (accountId: string) => {
    const account = await services.iCloudSecret(input.userId, accountId);
    try { return await services.readICloudInbox(account.email, account.password, account.id); }
    catch (error) { await services.recordICloudCheck(input.userId, account.id, error, account.revision); throw new Error('iCloud Mail could not be read. Check its connection in Connected apps.'); }
  };
  return {
    icloud_list_accounts: tool({ description: 'List the authenticated user’s iCloud Mail accounts. Never use Gmail tools for iCloud messages.', inputSchema: z.object({}), execute: async () => ({ accounts }) }),
    icloud_search_messages: tool({ description: 'Search the latest 100 messages in this connected iCloud inbox. This is bounded recent evidence, not the entire mailbox. Use returned IDs for reading.', inputSchema: accountSchema.extend({ query: z.string().max(500).default(''), limit: z.number().int().min(1).max(25).default(10) }),
      execute: async ({ accountId, query, limit }) => executeGuardedAction({ ...input, toolName: 'icloud_search_messages', risk: 'read', preview: 'Search iCloud Mail', args: { accountId, query, limit }, execute: async () => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const messages = (await emails(accountId)).filter(item => terms.every(term => `${item.from} ${item.subject} ${item.body}`.toLowerCase().includes(term))).slice(0, limit);
        return { messages: messages.map(({ body, ...item }) => item), scope: 'latest_100_inbox_messages' };
      } }),
    }),
    icloud_read_message: tool({ description: 'Read an iCloud inbox message using the exact account and message IDs returned by search. Read-only.', inputSchema: accountSchema.extend({ messageId: z.string().max(300) }), execute: async ({ accountId, messageId }) => executeGuardedAction({ ...input, toolName: 'icloud_read_message', risk: 'read', preview: 'Read iCloud Mail', args: { accountId, messageId }, execute: async () => {
      const account = await services.iCloudSecret(input.userId, accountId);
      return services.readICloudMessage(account.email, account.password, account.id, messageId);
    } }) }),
    icloud_send_email: tool({ description: 'Prepare an iCloud email for the existing email-review card. Use replyToMessageId for a reply to an observed source email. Sending always waits for explicit user review. Call with identical input after approval; do not repeat an uncertain send. For partial or rejected delivery, use retryOfActionId from the returned actionId to prepare a separately reviewed follow-up to only retryRecipients; never resend to accepted recipients.', inputSchema: accountSchema.extend({ to: z.array(z.string().email()).min(1).max(20), subject: z.string().min(1).max(300).refine(value => !/[\r\n]/.test(value)), body: z.string().min(1).max(30000), replyToMessageId: z.string().max(300).optional(), retryOfActionId: z.string().uuid().optional() }), execute: async args => {
      if (args.retryOfActionId) {
        const direct = await input.store.getAction(args.retryOfActionId, input.runId);
        const prior = direct ?? (await input.store.getSnapshot(input.runId))?.actions.find(action =>
          action.toolName === 'icloud_send_email' && action.status === 'executed' && typeof action.result?.$reusedFromRunId === 'string'
          && action.result?.actionId === args.retryOfActionId);
        const rejected = new Set(Array.isArray(prior?.result?.retryRecipients) ? prior.result.retryRecipients.filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase()) : []);
        if (!prior || prior.toolName !== 'icloud_send_email' || prior.status !== 'executed' || prior.input.accountId !== args.accountId || !args.to.every(value => rejected.has(value.toLowerCase()))) throw new Error('Only recipients that did not receive the earlier email can be retried.');
      }
      // Check account ownership/access before presenting approval.
      await services.iCloudSecret(input.userId, args.accountId);
      return executeGuardedAction({ ...input, toolName: 'icloud_send_email', risk: 'write_external', preview: `Send email to ${args.to.join(', ')}\n${args.subject}\n${args.body}`, args: { ...args, approvalCategory: 'email_send' }, execute: async (approved, action) => {
        const account = await services.iCloudSecret(input.userId, String(approved.accountId));
        const edit = action.result?.approvedEmailEdit === undefined ? { subject: String(approved.subject), body: String(approved.body) } : emailDraftEditSchema.parse(action.result.approvedEmailEdit);
        let inReplyTo: string | undefined;
        if (approved.replyToMessageId) {
          const original = await services.readICloudMessage(account.email, account.password, account.id, String(approved.replyToMessageId));
          if (!original?.rfcMessageId || /[\r\n]/.test(original.rfcMessageId)) throw new Error('The source email is no longer available to reply to. Nothing was sent.');
          inReplyTo = original.rfcMessageId;
        }
        let result;
        try { result = await services.sendICloudMessage(account.email, account.password, { to: approved.to as string[], ...edit, inReplyTo, messageId: `<dash-${action.id}@icloud.com>` }); }
        catch (error) {
          await services.recordICloudCheck(input.userId, account.id, error, account.revision);
          throw new Error('iCloud Mail could not confirm this send. Check the connection and the sent email before trying again.');
        }
        const sent = result.accepted.length === (approved.to as string[]).length && result.rejected.length === 0;
        return { ...result, actionId: action.id, sent, deliveryStatus: sent ? 'sent' : result.accepted.length ? 'partial' : 'rejected',
          ...(!sent ? { retryRecipients: result.rejected, note: 'Some recipients did not receive this email. A new email to only those recipients requires separate review. Do not resend to accepted recipients.' } : {}), ...(action.result?.approvedEmailEdit ? { approvedEmailEdit: edit } : {}) };
      } });
    } }),
  } satisfies ToolSet;
}
