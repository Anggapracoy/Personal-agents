import { getGoogleConnectionAccessToken, getPrimaryGoogleConnectionId, listConnectedGoogleAccounts } from "../auth/google-connections";
import type { EventBaseline, EventCondition } from "./definition";
import { getPauseStore, type SavedPause } from "./store";

type Mail = { id: string; internalDate?: string; labelIds?: string[]; payload?: { headers?: Array<{ name: string; value: string }> } };
type CalendarEvent = { id: string; summary?: string; created?: string; status?: string; start?: { dateTime?: string; date?: string } };
export class WaitSourceError extends Error {
  constructor(message: string, readonly permanent: boolean) { super(message); }
}
async function readGoogle<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new WaitSourceError(`The wait source returned HTTP ${response.status}.`, [400, 401, 403, 404, 410].includes(response.status));
  return response.json() as Promise<T>;
}
async function thread(token: string, id: string) {
  return (await readGoogle<{ messages?: Mail[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From`, token)).messages ?? [];
}
async function calendar(token: string, condition: Extract<EventCondition, { kind: "calendar_event_created" }>) {
  const events: CalendarEvent[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ timeMin: condition.timeMin, timeMax: condition.timeMax, singleEvents: "true", maxResults: "2500", showDeleted: "false", fields: "items(id,summary,created,status,start),nextPageToken" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await readGoogle<{ items?: CalendarEvent[]; nextPageToken?: string }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, token);
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? "";
    if (events.length > 25000) throw new WaitSourceError("The calendar range is too large. Choose a narrower window.", true);
  } while (pageToken);
  return events;
}
export function incomingReply(messages: Mail[], condition: Extract<EventCondition, { kind: "gmail_reply" }>, baseline: EventBaseline) {
  const seen = new Set(baseline.ids);
  return messages.find(message => {
    if (seen.has(message.id) || !message.internalDate || Number(message.internalDate) < Date.parse(baseline.since)) return false;
    if (message.labelIds?.some(label => ["SENT", "DRAFT", "TRASH", "SPAM"].includes(label))) return false;
    const from = message.payload?.headers?.find(header => header.name.toLowerCase() === "from")?.value ?? "";
    const sender = (from.match(/<([^<>]+)>/)?.[1] ?? from).trim().toLowerCase();
    if (!sender || sender === baseline.accountEmail.toLowerCase()) return false;
    return !condition.sender || sender === condition.sender.toLowerCase();
  });
}
export function createdEvent(events: CalendarEvent[], condition: Extract<EventCondition, { kind: "calendar_event_created" }>, baseline: EventBaseline) {
  const seen = new Set(baseline.ids);
  return events.find(event => {
    const start = event.start?.dateTime ?? event.start?.date;
    return !seen.has(event.id) && event.status !== "cancelled" && event.summary?.trim().toLowerCase() === condition.title.trim().toLowerCase()
      && !!event.created && Date.parse(event.created) >= Date.parse(baseline.since)
      && !!start && Date.parse(start) >= Date.parse(condition.timeMin) && Date.parse(start) < Date.parse(condition.timeMax);
  });
}
export async function captureEventBaseline(owner: string, condition: EventCondition, preferredConnectionId?: string | null) {
  const connectionId = condition.connectionId ?? (preferredConnectionId === "session" ? null : preferredConnectionId) ?? await getPrimaryGoogleConnectionId(owner);
  const accounts = await listConnectedGoogleAccounts(owner);
  const account = accounts.find(item => item.id === connectionId && item.enabled);
  if (!account) throw new Error("Connect the Google account for this wait first.");
  const token = await getGoogleConnectionAccessToken(owner, account.id);
  if (!token) throw new Error("Reconnect the Google account before setting this wait.");
  const since = new Date().toISOString();
  let baseline: EventBaseline;
  if (condition.kind === "gmail_reply") {
    const messages = (await thread(token, condition.threadId)).sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
    if (!messages.length) throw new Error("The email thread could not be found.");
    const anchor = condition.afterMessageId ? messages.findIndex(message => message.id === condition.afterMessageId) : -1;
    if (condition.afterMessageId && anchor < 0) throw new Error("The starting message is not in this email thread.");
    baseline = { ids: (anchor >= 0 ? messages.slice(0, anchor + 1) : messages.filter(message => !message.internalDate || Number(message.internalDate) < Date.parse(since))).map(message => message.id), since: anchor >= 0 && messages[anchor].internalDate ? new Date(Number(messages[anchor].internalDate)).toISOString() : since, accountEmail: account.email };
  } else {
    baseline = { ids: (await calendar(token, condition)).filter(event => !event.created || Date.parse(event.created) < Date.parse(since)).map(event => event.id), since, accountEmail: account.email };
  }
  return { connectionId: account.id, baseline };
}
export async function checkEventPause(pause: SavedPause) {
  if (pause.definition.condition.type !== "event" || !pause.baseline || !pause.connectionId) return null;
  const token = await getGoogleConnectionAccessToken(pause.ownerEmail, pause.connectionId);
  if (!token) throw new WaitSourceError("The connected Google account needs reconnection.", true);
  const condition = pause.definition.condition.event;
  if (condition.kind === "gmail_reply") {
    const match = incomingReply(await thread(token, condition.threadId), condition, pause.baseline);
    return match ? { kind: "gmail_reply", messageId: match.id, threadId: condition.threadId, connectionId: pause.connectionId } : null;
  }
  const match = createdEvent(await calendar(token, condition), condition, pause.baseline);
  if (match) return { kind: "calendar_event_created", eventId: match.id, connectionId: pause.connectionId };
  if (Date.parse(condition.timeMax) <= Date.now()) return { kind: "window_ended", message: "The calendar window ended without a matching new event. Explain this; do not claim it happened." };
  return null;
}
/** Push notifications reduce latency; reconciliation also catches missed/disabled pushes. */
export async function reconcileEventPauses(connectionId?: string, source?: "gmail" | "calendar", pauseId?: string) {
  const store = getPauseStore();
  const pauses = await store.events(connectionId, pauseId);
  for (const pause of pauses) {
    if (pause.definition.condition.type !== "event") continue;
    if (source && (pause.definition.condition.event.kind === "gmail_reply" ? "gmail" : "calendar") !== source) continue;
    try {
      const reason = await checkEventPause(pause);
      await store.resetCheckFailures(pause.id);
      if (reason) await store.markReady(pause.id, reason);
    } catch (error) {
      if (error instanceof WaitSourceError && error.permanent) await store.markReady(pause.id, { kind: "source_unavailable", message: error.message });
      else if (await store.recordCheckFailure(pause.id) >= 3) await store.markReady(pause.id, { kind: "source_unavailable", message: "The wait source could not be checked after repeated attempts. Tell the user the check failed; do not claim the event happened." });
      else console.warn("[automatic-wait] Source check will retry", { pauseId: pause.id });
    }
  }
}
