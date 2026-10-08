type GmailList = { messages?: Array<{ id: string; threadId?: string }> };
export type GmailMessageRef = { id: string; threadId?: string };
type GmailProfile = { historyId?: string };
type GmailHistoryPage = {
  historyId?: string;
  nextPageToken?: string;
  history?: Array<{
    messages?: GmailMessageRef[];
    messagesAdded?: Array<{ message: GmailMessageRef }>;
    labelsAdded?: Array<{ message: GmailMessageRef }>;
  }>;
};
export type GmailHistoryChanges = { historyId: string; messages: GmailMessageRef[] };
type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
type GmailMessage = { id: string; threadId?: string; snippet?: string; labelIds?: string[]; payload?: GmailPart & { headers?: Array<{ name: string; value: string }> } };
type CalendarList = { items?: GoogleEvent[] };
type GoogleService = "Gmail" | "Google Calendar";
type GoogleErrorPayload = {
  error?: {
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string }>;
  };
};
export type GoogleEvent = { id: string; summary?: string; description?: string; location?: string; htmlLink?: string; attendees?: Array<{ email?: string; displayName?: string }>; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };

export class GoogleApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export function explainGoogleApiFailure(service: GoogleService, status: number, payload: GoogleErrorPayload | null) {
  const reason = payload?.error?.errors?.[0]?.reason ?? payload?.error?.status ?? "";
  const detail = payload?.error?.message ?? "";
  const combined = `${reason} ${detail}`.toLowerCase();

  if (status === 401) return "Your Google connection expired. Sign out and sign in with Google again.";
  if (status === 403 && /accessnotconfigured|service_disabled|has not been used|is disabled/.test(combined)) {
    return `${service} API is disabled for this Google Cloud project. Enable it in Google Cloud, wait a minute, then scan again.`;
  }
  if (status === 403 && /insufficientpermissions|insufficient authentication scopes|permission_denied/.test(combined)) {
    return `${service} access was not granted. Sign out, sign in with Google again, and approve the requested access.`;
  }
  if (status === 403 && /quota|ratelimit|daily limit/.test(combined)) {
    return `${service} API quota is exhausted. Check the Google Cloud quota and try again later.`;
  }
  if (status === 429) return `${service} is temporarily rate-limiting this account. Wait a moment, then scan again.`;
  return `${service} denied the request (${status})${detail ? `: ${detail}` : "."}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function googleFetch<T>(path: string, accessToken: string, service: GoogleService, attempt = 0): Promise<T> {
  const response = await fetch(path, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as GoogleErrorPayload | null;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 4_000)
        : 400 * (2 ** attempt);
      console.warn("[google-api] transient request retry", { service, status: response.status, attempt: attempt + 1, delayMs });
      await wait(delayMs);
      return googleFetch<T>(path, accessToken, service, attempt + 1);
    }
    throw new GoogleApiError(explainGoogleApiFailure(service, response.status, payload), response.status);
  }
  return response.json() as Promise<T>;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

// A bounded, deterministic safety net for consequential messages that may have
// fallen below the newest 150 inbox items. This is one cheap Gmail list query;
// it does not invoke a model or research every sender seen in the inbox.
export const CRITICAL_GMAIL_QUERY = 'in:anywhere is:unread newer_than:30d {subject:payment subject:"past due" subject:overdue subject:"service paused" subject:"service suspended" subject:"account suspended" subject:"action required" subject:"respond by" subject:"confirm by" subject:"subscription ends" subject:"subscription expires" subject:"trial ends" subject:"unusual activity" subject:"security alert"}';

export async function fetchCriticalEmailRefs(accessToken: string, maxResults = 50): Promise<GmailMessageRef[]> {
  const params = new URLSearchParams({ maxResults: String(Math.min(50, Math.max(1, maxResults))), q: CRITICAL_GMAIL_QUERY });
  const list = await googleFetch<GmailList>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, accessToken, "Gmail");
  return list.messages ?? [];
}

export async function fetchDiscoveryEmailRefs(accessToken: string): Promise<GmailMessageRef[]> {
  const [recent, critical] = await Promise.all([
    fetchRecentEmailRefs(accessToken),
    fetchCriticalEmailRefs(accessToken),
  ]);
  const byId = new Map<string, GmailMessageRef>();
  for (const message of [...recent, ...critical]) byId.set(message.id, message);
  return [...byId.values()];
}

/** Exceptional cursor-expiry recovery must cover sent replies as well as inbox. */
export async function fetchRecoveryEmailRefs(accessToken: string): Promise<GmailMessageRef[]> {
  const [inbox, sent] = await Promise.all([
    fetchDiscoveryEmailRefs(accessToken),
    googleFetch<GmailList>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ maxResults: '150', q: 'in:sent newer_than:21d' })}`, accessToken, 'Gmail'),
  ]);
  return [...new Map([...inbox, ...(sent.messages ?? [])].map(message => [message.id, message])).values()];
}

export async function fetchGmailProfileHistoryId(accessToken: string) {
  const profile = await googleFetch<GmailProfile>("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken, "Gmail");
  if (!profile.historyId) throw new Error("Gmail did not return a history cursor.");
  return profile.historyId;
}

/**
 * Returns only messages changed since the last successful scan. Gmail history
 * cursors can expire; callers intentionally fall back to the bounded full scan
 * when that happens so the optimization can never create a false negative.
 */
export async function fetchGmailHistoryChanges(accessToken: string, startHistoryId: string): Promise<GmailHistoryChanges> {
  const byId = new Map<string, GmailMessageRef>();
  let pageToken = "";
  let latestHistoryId = startHistoryId;
  do {
    const params = new URLSearchParams({ startHistoryId, maxResults: "500" });
    params.append("historyTypes", "messageAdded");
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleFetch<GmailHistoryPage>(`https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`, accessToken, "Gmail");
    latestHistoryId = page.historyId ?? latestHistoryId;
    for (const history of page.history ?? []) {
      for (const added of history.messagesAdded ?? []) byId.set(added.message.id, added.message);
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return { historyId: latestHistoryId, messages: [...byId.values()] };
}

export function unreviewedGmailMessageIds(messages: GmailMessageRef[], reviewedMessageIds: string[]) {
  const reviewed = new Set(reviewedMessageIds);
  return [...new Set(messages.map((message) => message.id))].filter((id) => !reviewed.has(id));
}

export async function fetchDiscoveryEmails(accessToken: string) {
  return fetchEmailsByIds(accessToken, (await fetchDiscoveryEmailRefs(accessToken)).map((message) => message.id));
}

export async function fetchRecentEmailRefs(accessToken: string, maxResults = 150): Promise<GmailMessageRef[]> {
  const query = "in:inbox newer_than:7d";
  const params = new URLSearchParams({ maxResults: String(Math.min(150, Math.max(1, maxResults))), q: query });
  const list = await googleFetch<GmailList>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, accessToken, "Gmail");
  return list.messages ?? [];
}

export async function fetchEmailsByIds(accessToken: string, messageIds: string[]) {
  // Gmail enforces a low per-user concurrent-request ceiling. A bounded pool
  // avoids turning the message scan into a burst that Google rejects.
  // Gmail history/list results are not snapshots: a message can be deleted or
  // moved out of the account between listing it and downloading it. Treat that
  // one 404 as a stale reference instead of discarding the entire scan.
  const messages = await mapWithConcurrency<string, GmailMessage | null>(messageIds, 6, async (id) => {
    try {
      return await googleFetch<GmailMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, accessToken, "Gmail");
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        console.warn("[google-api] skipped stale Gmail message reference", { messageId: id });
        return null;
      }
      throw error;
    }
  });
  return messages.filter((message): message is GmailMessage => message !== null).map(emailDetails);
}

function emailDetails(message: GmailMessage) {
  const body = messageBody(message.payload);
  // Keep the raw HTML for link extraction. `messageBody` intentionally strips
  // markup for model context, which used to erase button-only CTA URLs such as
  // "Complete Waiver Now" before the agent could ever open them.
  const html = messageHtml(message.payload);
  const sourceText = `${message.snippet ?? ""}\n${body}\n${html}`;
  return {
    id: message.id,
    threadId: message.threadId ?? message.id,
    subject: header(message, "subject") || "Email decision",
    from: header(message, "from"),
    to: header(message, "to"),
    date: header(message, "date"),
    snippet: message.snippet ?? "",
    body,
    links: extractLinks(sourceText).slice(0, 100),
    confirmationNumbers: extractConfirmationNumbers(sourceText),
    attachments: messageAttachments(message.payload),
    labels: message.labelIds ?? [],
    listUnsubscribe: header(message, "list-unsubscribe"),
    precedence: header(message, "precedence"),
    autoSubmitted: header(message, "auto-submitted"),
    replyTo: header(message, "reply-to"),
  };
}

/** Thread IDs matching a Gmail search, newest first. */
export async function searchGmailThreadIds(accessToken: string, query: string, maxResults = 20) {
  const params = new URLSearchParams({ maxResults: String(Math.min(50, Math.max(1, maxResults))), q: query });
  const list = await googleFetch<{ threads?: Array<{ id: string }> }>(`https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`, accessToken, "Gmail");
  return (list.threads ?? []).map(thread => thread.id);
}

/** Every message in a thread, oldest first. */
export async function fetchGmailThread(accessToken: string, threadId: string) {
  const thread = await googleFetch<{ messages?: GmailMessage[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, accessToken, "Gmail");
  return (thread.messages ?? []).map(emailDetails);
}

export async function fetchGmailMessage(accessToken: string, messageId: string) {
  const message = await googleFetch<GmailMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, accessToken, "Gmail");
  return emailDetails(message);
}

export async function fetchGmailAttachment(accessToken: string, messageId: string, attachmentId: string) {
  const result = await googleFetch<{ data?: string; size?: number }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, accessToken, "Gmail");
  if (!result.data) throw new Error("Gmail attachment did not contain data.");
  return { bytes: Buffer.from(result.data.replace(/-/g, "+").replace(/_/g, "/"), "base64"), size: result.size ?? 0 };
}

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
}

function decodeBody(value?: string) {
  if (!value) return "";
  try { return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
}

function stripHtml(value: string) {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}

function flattenParts(part?: GmailPart): GmailPart[] {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}

function messageBody(payload?: GmailPart) {
  const parts = flattenParts(payload);
  const plain = parts.filter((part) => part.mimeType === "text/plain" && part.body?.data).map((part) => decodeBody(part.body?.data)).join("\n").trim();
  if (plain) return plain;
  const html = messageHtml(payload);
  return stripHtml(html || decodeBody(payload?.body?.data));
}

function messageHtml(payload?: GmailPart) {
  return flattenParts(payload)
    .filter((part) => part.mimeType === "text/html" && part.body?.data)
    .map((part) => decodeBody(part.body?.data))
    .join("\n");
}

function messageAttachments(payload?: GmailPart) {
  return flattenParts(payload).flatMap((part) => part.filename && part.body?.attachmentId ? [{ id: part.body.attachmentId, name: part.filename, mimeType: part.mimeType ?? "application/octet-stream", size: part.body.size ?? 0 }] : []);
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

export function extractLinks(value: string) {
  const candidates = [
    ...(value.match(/https:\/\/[^\s<>"')\]]+/gi) ?? []),
    ...[...value.matchAll(/\bhref\s*=\s*(["'])([\s\S]*?)\1/gi)].map((match) => match[2] ?? ""),
    ...[...value.matchAll(/\bhref\s*=\s*(https:\/\/[^\s>]+)/gi)].map((match) => match[1] ?? ""),
  ];
  return [...new Set(candidates
    .map((candidate) => decodeHtmlAttribute(candidate).trim().replace(/[.,;:]+$/, ""))
    .filter((candidate) => {
      try { return new URL(candidate).protocol === "https:"; } catch { return false; }
    }))];
}

function extractConfirmationNumbers(value: string) {
  const matches = value.matchAll(/\b(?:confirmation|booking|reservation|order|invoice)(?:\s+(?:number|no\.?|id))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,39})\b/gi);
  return [...new Set([...matches].map((match) => match[1]!).filter((candidate) => /\d/.test(candidate)))].slice(0, 30);
}

export async function fetchCalendarEventsInRange(accessToken: string, timeMin: string, timeMax: string, maxResults = 150) {
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: String(Math.min(250, Math.max(1, maxResults))),
  });
  const list = await googleFetch<CalendarList>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, accessToken, "Google Calendar");
  return list.items ?? [];
}

export async function fetchUpcomingEvents(accessToken: string) {
  const start = new Date();
  const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  const scanLimit = { maxResults: "150" };
  return fetchCalendarEventsInRange(accessToken, start.toISOString(), end.toISOString(), Number(scanLimit.maxResults));
}

export function findCalendarConflicts(events: GoogleEvent[]) {
  const timed = events.filter((event) => event.start?.dateTime && event.end?.dateTime);
  const conflicts: Array<[GoogleEvent, GoogleEvent]> = [];
  for (let index = 0; index < timed.length - 1; index += 1) {
    const current = timed[index];
    const next = timed[index + 1];
    if (new Date(next.start!.dateTime!).getTime() < new Date(current.end!.dateTime!).getTime()) conflicts.push([current, next]);
  }
  return conflicts;
}
