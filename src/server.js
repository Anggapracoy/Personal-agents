import http from 'node:http';
import { parseReminder, ReminderStore, ReminderScheduler, formatProposal } from './reminders.js';
import { verifyWebhook, parseWebhook, textMessage, approvalButtonMessage, sendWhatsAppMessage, verifySignature } from './whatsapp.js';
import { buildAuthorizationUrl, buildCalendarEvent, createCodeChallenge, createCodeVerifier, createEvent, createOAuthState, exchangeCode, findConflicts, listEvents, refreshAccessToken, revokeToken } from './google-calendar.js';
import { createOAuthSession, validOAuthSession, TokenStore } from './oauth.js';
import { formatMeetingProposal, MeetingProposalStore, parseMeetingRequest } from './meetings.js';
import { AuditLog } from './audit.js';

const store = new ReminderStore(process.env.ANAKBUAH_DATA_FILE || './data/reminders.json');
const processed = new Set();
const requestWindows = new Map();
const oauthSessions = new Map();
const meetingProposals = new MeetingProposalStore(process.env.ANAKBUAH_MEETING_FILE || './data/meeting-proposals.json');
const audit = new AuditLog(process.env.ANAKBUAH_AUDIT_FILE || './data/audit.jsonl');
const tokenStore = process.env.ANAKBUAH_TOKEN_KEY ? new TokenStore(process.env.ANAKBUAH_TOKEN_FILE || './data/google-tokens.json', process.env.ANAKBUAH_TOKEN_KEY) : null;
async function accessTokenFor(userId) {
  const token = tokenStore?.get(userId);
  if (!token?.access_token) return null;
  if (token.expires_at && token.expires_at > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return token.access_token;
  const refreshed = await refreshAccessToken({ refreshToken: token.refresh_token, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET });
  tokenStore.set(userId, { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token, expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000 });
  return refreshed.access_token;
}
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function readBody(req) { return new Promise((resolve, reject) => { let data = ''; req.on('data', c => { data += c; if (data.length > 1_000_000) reject(new Error('payload too large')); }); req.on('end', () => resolve(data)); req.on('error', reject); }); }

export function createServer({ verifyToken = process.env.WHATSAPP_VERIFY_TOKEN, appSecret = process.env.WHATSAPP_APP_SECRET } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok', service: 'anakbuah', checks: { whatsapp_verify: Boolean(verifyToken), google_oauth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REDIRECT_URI), token_storage: Boolean(tokenStore) }, metrics: { reminders_needing_attention: store.attentionCount() } });
      if (req.method === 'GET' && req.url?.startsWith('/webhooks/whatsapp')) {
        const q = new URL(req.url, 'http://localhost').searchParams;
        const result = verifyWebhook(q.get('hub.mode'), q.get('hub.verify_token'), q.get('hub.challenge'), verifyToken);
        return result ? (res.writeHead(200, { 'content-type': 'text/plain' }), res.end(result)) : json(res, 403, { error: 'verification failed' });
      }
      if (req.method === 'GET' && req.url?.startsWith('/oauth/google/start')) {
        const q = new URL(req.url, 'http://localhost').searchParams; const userId = q.get('userId');
        if (!userId || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) return json(res, 503, { error: 'Google OAuth is not configured' });
        const state = createOAuthState(); const codeVerifier = createCodeVerifier(); oauthSessions.set(state, createOAuthSession({ state, codeVerifier, userId }));
        return res.writeHead(302, { location: buildAuthorizationUrl({ clientId: process.env.GOOGLE_CLIENT_ID, redirectUri: process.env.GOOGLE_REDIRECT_URI, state, codeChallenge: createCodeChallenge(codeVerifier) }) }).end();
      }
      if (req.method === 'GET' && req.url?.startsWith('/oauth/google/callback')) {
        const q = new URL(req.url, 'http://localhost').searchParams; const session = oauthSessions.get(q.get('state'));
        if (!validOAuthSession(session, q.get('state')) || !q.get('code')) return json(res, 400, { error: 'invalid or expired OAuth session' });
        if (!tokenStore) return json(res, 503, { error: 'token storage is not configured' });
        const token = await exchangeCode({ code: q.get('code'), codeVerifier: session.codeVerifier, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI });
        tokenStore.set(session.userId, { ...token, expires_at: Date.now() + (token.expires_in || 3600) * 1000 }); oauthSessions.delete(q.get('state')); return json(res, 200, { connected: true });
      }
      if (req.method !== 'POST' || req.url !== '/webhooks/whatsapp') return json(res, 404, { error: 'not found' });
      const source = req.socket.remoteAddress || 'unknown'; const now = Date.now(); const window = requestWindows.get(source);
      if (!window || now - window.startedAt >= 60_000) requestWindows.set(source, { startedAt: now, count: 1 });
      else { window.count++; if (window.count > 100) return json(res, 429, { error: 'rate limit exceeded' }); }
      meetingProposals.prune();
      const rawBody = await readBody(req);
      if (appSecret && !verifySignature(rawBody, req.headers['x-hub-signature-256'], appSecret)) return json(res, 403, { error: 'invalid webhook signature' });
      const event = parseWebhook(JSON.parse(rawBody));
      if (!event) return json(res, 200, { received: true, ignored: true });
      if (processed.has(event.messageId)) return json(res, 200, { received: true, duplicate: true });
      processed.add(event.messageId);
      if (/^(putuskan|disconnect)\s+(google|kalender)$/i.test(event.text.trim())) {
        const token = tokenStore?.get(event.userId); if (token?.access_token) await revokeToken(token.access_token).catch(() => {}); const removed = tokenStore?.delete(event.userId) || false;
        audit.record({ action: 'google_disconnect', userId: event.userId, outcome: removed ? 'success' : 'not_connected' });
        return json(res, 200, { received: true, reply: textMessage(event.userId, removed ? 'Google Calendar sudah diputuskan.' : 'Tidak ada Google Calendar yang sedang terhubung.') });
      }
      if (/^setuju$/i.test(event.text.trim())) {
        const item = store.latestPending(event.userId); const approved = item && store.approve(item.id, event.userId);
        audit.record({ action: 'reminder_approve', userId: event.userId, resourceId: approved?.id, outcome: approved ? 'success' : 'not_found' });
        return json(res, 200, { received: true, reply: textMessage(event.userId, approved ? `Siap, reminder “${approved.task}” sudah aktif.` : 'Tidak ada reminder yang menunggu persetujuan.') });
      }
      if (event.text.startsWith('approve:') && !event.text.startsWith('approve:meeting:approve:')) {
        const item = store.approve(event.text.slice('approve:'.length), event.userId);
        return json(res, 200, { received: true, reply: textMessage(event.userId, item ? `Siap, reminder “${item.task}” sudah aktif.` : 'Approval tidak valid atau sudah kedaluwarsa.') });
      }
      if (event.text.startsWith('cancel:')) {
        if (event.text.startsWith('cancel:meeting:approve:')) {
          const proposalId = event.text.slice('cancel:meeting:approve:'.length); const proposal = meetingProposals.get(proposalId);
          if (!proposal || proposal.userId !== event.userId) return json(res, 200, { received: true, reply: textMessage(event.userId, 'Proposal meeting tidak ditemukan atau sudah kedaluwarsa.') });
          meetingProposals.delete(proposalId);
          return json(res, 200, { received: true, reply: textMessage(event.userId, 'Proposal meeting dibatalkan.') });
        }
        const item = store.cancel(event.text.slice('cancel:'.length), event.userId);
        return json(res, 200, { received: true, reply: textMessage(event.userId, item ? `Reminder “${item.task}” dibatalkan.` : 'Reminder tidak ditemukan atau sudah dikirim.') });
      }
      if (/^batal(?:kan)?$/i.test(event.text.trim())) {
        const item = store.latestPending(event.userId); const cancelled = item && store.cancel(item.id, event.userId);
        return json(res, 200, { received: true, reply: textMessage(event.userId, cancelled ? `Reminder “${cancelled.task}” dibatalkan.` : 'Tidak ada reminder yang menunggu persetujuan.') });
      }
      const snooze = event.text.match(/^tunda\s+(\d+)\s*(menit|jam)$/i);
      if (snooze) {
        const minutes = Number(snooze[1]) * (snooze[2].toLowerCase() === 'jam' ? 60 : 1);
        const item = store.snooze(store.latestDelivered(event.userId)?.id, event.userId, minutes);
        return json(res, 200, { received: true, reply: textMessage(event.userId, item ? `Reminder “${item.task}” ditunda ${snooze[1]} ${snooze[2]}.` : 'Tidak ada reminder terkirim yang bisa ditunda.') });
      }
      if (event.text.startsWith('approve:meeting:approve:')) {
        const proposalId = event.text.slice('approve:meeting:approve:'.length); const proposal = meetingProposals.get(proposalId);
        if (!proposal || proposal.userId !== event.userId || Date.now() - proposal.createdAt > 10 * 60 * 1000) return json(res, 200, { received: true, reply: textMessage(event.userId, 'Proposal meeting sudah kedaluwarsa.') });
        const accessToken = await accessTokenFor(event.userId); if (!accessToken) return json(res, 200, { received: true, reply: textMessage(event.userId, 'Google Calendar perlu dihubungkan ulang.') });
        const created = await createEvent({ accessToken, event: proposal.event }); meetingProposals.delete(proposalId);
        return json(res, 200, { received: true, reply: textMessage(event.userId, `Meeting berhasil dibuat: ${created.htmlLink || created.id}`) });
      }
      const meeting = parseMeetingRequest(event.text, event.receivedAt);
      if (meeting) {
        const accessToken = await accessTokenFor(event.userId);
        if (!accessToken) {
          const connectUrl = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REDIRECT_URI ? `/oauth/google/start?userId=${encodeURIComponent(event.userId)}` : 'Google OAuth belum dikonfigurasi di server.';
          return json(res, 200, { received: true, reply: textMessage(event.userId, `Hubungkan Google Calendar dulu melalui: ${connectUrl}`) });
        }
        const events = await listEvents({ accessToken, timeMin: meeting.start, timeMax: meeting.end });
        const conflicts = findConflicts(events, meeting.start, meeting.end);
        if (conflicts.length) return json(res, 200, { received: true, reply: textMessage(event.userId, formatMeetingProposal(meeting, conflicts)) });
        const id = `meeting_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        meetingProposals.set(id, { userId: event.userId, createdAt: Date.now(), event: buildCalendarEvent({ summary: meeting.title, start: meeting.start, end: meeting.end, timeZone: meeting.timeZone }) });
        return json(res, 200, { received: true, reply: approvalButtonMessage(event.userId, formatMeetingProposal(meeting), `meeting:approve:${id}`) });
      }
      const parsed = parseReminder(event.text, event.receivedAt);
      if (!parsed) return json(res, 200, { received: true, reply: textMessage(event.userId, 'Contoh: “Ingatkan saya bayar listrik besok jam 9 pagi.”') });
      const item = store.create(event.userId, parsed);
      return json(res, 200, { received: true, reply: approvalButtonMessage(event.userId, formatProposal(item), item.id) });
    } catch (error) { console.error('request failed:', error.message); return json(res, 502, { error: 'upstream or server request failed' }); }
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const scheduler = new ReminderScheduler(store, async item => {
    const message = textMessage(item.userId, `Reminder: ${item.task}`);
    if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
      await sendWhatsAppMessage({ phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID, accessToken: process.env.WHATSAPP_ACCESS_TOKEN, to: item.userId, message }).catch(error => console.error(error.message));
    } else console.log(JSON.stringify({ reminder: item.id, to: item.userId, message: message.text.body }));
  });
  scheduler.start();
  const server = createServer();
  server.listen(process.env.PORT || 3000);
  const shutdown = signal => { console.log(`received ${signal}, shutting down`); scheduler.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
