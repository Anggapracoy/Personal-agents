import type { Readable } from "node:stream";
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import type { DecisionEmailInput } from '../agent';

export class ICloudConnectionError extends Error {}
export const ICLOUD_HOST = 'imap.mail.me.com';
export function iCloudCredentials(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@(icloud\.com|me\.com|mac\.com)$/.test(normalized)) throw new ICloudConnectionError('Enter your primary iCloud Mail address, ending in @icloud.com, @me.com, or @mac.com.');
  const secret = password.trim();
  if (!/^[a-z]{4}(-[a-z]{4}){3}$/i.test(secret)) throw new ICloudConnectionError('Use the app-specific password from Apple, not your Apple Account password.');
  return { email: normalized, password: secret };
}
export function iCloudAuthRejected(error: unknown) { return Boolean(error && typeof error === 'object' && ((error as { authenticationFailed?: boolean }).authenticationFailed || (error as { code?: string }).code === "EAUTH")); }

export type ICloudMailClient = Pick<ImapFlow, "connect" | "logout" | "close" | "on" | "mailboxOpen" | "fetchAll" | "download">;
export type ICloudClientFactory = (options: ImapFlowOptions) => ICloudMailClient;
const createClient: ICloudClientFactory = options => new ImapFlow(options);
async function withMailbox<T>(email: string, password: string, work: (client: ICloudMailClient) => Promise<T>, factory = createClient) {
  const client = factory({ host: ICLOUD_HOST, port: 993, secure: true, auth: { user: email, pass: password }, logger: false,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, disableAutoIdle: true });
  client.on('error', () => {});
  const deadline = setTimeout(() => client.close(), 60_000);
  try { await client.connect(); return await work(client); }
  finally { clearTimeout(deadline); await client.logout().catch(() => client.close()); }
}
export async function verifyICloudMail(email: string, password: string, factory?: ICloudClientFactory) {
  return withMailbox(email, password, async client => { await client.mailboxOpen('INBOX', { readOnly: true }); }, factory);
}
export async function readICloudInbox(email: string, password: string, accountId: string, limit = 100, factory?: ICloudClientFactory, skipMessageIds: ReadonlySet<string> = new Set()): Promise<DecisionEmailInput[]> {
  return withMailbox(email, password, async client => {
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    if (!box.exists) return [];
    const envelopes = await client.fetchAll(`${Math.max(1, box.exists - limit + 1)}:*`, { uid: true, envelope: true, flags: true, size: true, internalDate: true });
    const result: DecisionEmailInput[] = [];
    for (const item of envelopes) {
      if (skipMessageIds.has(`icloud:${accountId}:${box.uidValidity}:${item.uid}`)) continue;
      if ((item.size ?? 0) > 3_000_000) continue;
      const downloaded = await client.download(String(item.uid), undefined, { uid: true, maxBytes: 3_000_000 });
      if (!downloaded.content) continue;
      result.push(await parsedICloudMessage(downloaded.content, accountId, String(box.uidValidity), item.uid, item.flags?.has('\\Seen') ?? false, item.internalDate ?? item.envelope?.date));
    }
    return result.reverse();
  }, factory);
}
async function parsedICloudMessage(content: Readable, accountId: string, validity: string, uid: number, seen: boolean, receivedAt?: string | Date): Promise<DecisionEmailInput> {
  const parsed = await simpleParser(content, { skipHtmlToText: false, skipTextToHtml: true, maxHtmlLengthToParse: 500_000 });
  const text = (parsed.text ?? '').slice(0, 30_000);
  const id = `icloud:${accountId}:${validity}:${uid}`;
  const rootReference = Array.isArray(parsed.references) ? parsed.references[0] : parsed.references;
  return { id, threadId: `icloud:${accountId}:${rootReference || parsed.inReplyTo || parsed.messageId || id}`,
    rfcMessageId: parsed.messageId, subject: parsed.subject ?? '(No subject)', from: parsed.from?.text ?? '',
    to: Array.isArray(parsed.to) ? parsed.to.map(x => x.text).join(', ') : parsed.to?.text ?? '',
    date: new Date(parsed.date ?? receivedAt ?? Date.now()).toISOString(), snippet: text.slice(0, 600), body: text,
    links: [...new Set(text.match(/https:\/\/[^\s<>"']+/g) ?? [])].slice(0, 30), confirmationNumbers: [], attachments: [], labels: seen ? [] : ['UNREAD'] };
}
export function iCloudMessageRef(accountId: string, messageId: string) {
  const parts = messageId.split(':');
  if (parts.length !== 4 || parts[0] !== 'icloud' || parts[1] !== accountId || !/^\d+$/.test(parts[2]) || !/^[1-9]\d*$/.test(parts[3])) throw new Error('Use the exact iCloud message ID from this account.');
  const uid = Number(parts[3]); if (!Number.isSafeInteger(uid)) throw new Error('Invalid message ID.');
  return { validity: parts[2], uid };
}
export async function readICloudMessage(email: string, password: string, accountId: string, messageId: string, factory?: ICloudClientFactory) {
  const ref = iCloudMessageRef(accountId, messageId);
  return withMailbox(email, password, async client => {
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    if (String(box.uidValidity) !== ref.validity) throw new Error('This mailbox changed. Search for the source email again.');
    const [message] = await client.fetchAll(String(ref.uid), { uid: true, flags: true, size: true, internalDate: true }, { uid: true });
    if (!message || message.uid !== ref.uid || (message.size ?? 0) > 3_000_000) throw new Error('This message is unavailable or larger than the current read limit.');
    const downloaded = await client.download(String(ref.uid), undefined, { uid: true, maxBytes: 3_000_000 });
    if (!downloaded.content) throw new Error('This message is unavailable.');
    return parsedICloudMessage(downloaded.content, accountId, ref.validity, message.uid, message.flags?.has('\\Seen') ?? false, message.internalDate);
  }, factory);
}

export function allICloudRecipientsRejected(error: unknown, recipients: string[]) {
  const value = error as { code?: unknown; command?: unknown; rejected?: unknown } | null;
  if (value?.code !== 'EENVELOPE' || value.command !== 'RCPT TO' || !Array.isArray(value.rejected)) return false;
  const rejected = new Set(value.rejected.filter((item): item is string => typeof item === 'string').map(item => item.toLowerCase()));
  return recipients.length > 0 && recipients.every(item => rejected.has(item.toLowerCase()));
}

export async function sendICloudMessage(email: string, password: string, message: { to: string[]; subject: string; body: string; messageId: string; inReplyTo?: string }) {
  const transport = nodemailer.createTransport({ host: 'smtp.mail.me.com', port: 587, secure: false, requireTLS: true,
    auth: { user: email, pass: password }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, logger: false });
  try { const sent = await transport.sendMail({ from: email, to: message.to, subject: message.subject, text: message.body, messageId: message.messageId, inReplyTo: message.inReplyTo, references: message.inReplyTo ? [message.inReplyTo] : undefined });
    return { messageId: sent.messageId, accepted: sent.accepted, rejected: sent.rejected }; }
  catch (error) {
    if (allICloudRecipientsRejected(error, message.to)) return { messageId: message.messageId, accepted: [] as string[], rejected: message.to };
    throw error;
  }
  finally { transport.close(); }
}
