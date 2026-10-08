import { sourceAccountIdOf } from "./google-secrets";
import { calendarApprovalPreview } from "../calendar-approval-preview";
import { withCalendarLocalTime } from "./calendar-time";
import { createHash } from "node:crypto";
import { validTimeZone } from "../temporal";
import { editedDraftRaw, emailDraftEditSchema } from "./email-draft-edit";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getGoogleConnectionAccessToken, getPrimaryGoogleConnectionId } from "../auth/google-connections";
import { fetchGmailAttachment, fetchGmailMessage } from "../google";
import { executeGuardedAction } from "./actions";
import type { AgentRunSnapshot, RunStore } from "./types";

function encodedPath(value: string) { return encodeURIComponent(value); }
function base64url(value: string | Buffer) { return Buffer.from(value).toString("base64url"); }
function cleanFilename(value: string) { return value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120) || "attachment.bin"; }
function validateEmailList(values: string[], label: string) {
  if (values.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new Error(`${label} contains an invalid email address.`);
}

const eventDateTimeSchema = z.string().datetime({ offset: true }).max(100);
const eventFieldsSchema = {
  summary: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  location: z.string().max(1000).optional(),
  start: eventDateTimeSchema,
  end: eventDateTimeSchema,
  timeZone: z.string().min(1).max(100).optional(),
  attendees: z.array(z.string().min(3).max(320)).max(50).default([]),
  addGoogleMeet: z.boolean().optional(),
};

type GmailSourceMessage = {
  threadId?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

type GoogleCalendarEvent = {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  organizer?: { email?: string; self?: boolean };
  attendees?: Array<{ email?: string; self?: boolean; organizer?: boolean; responseStatus?: string }>;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  [key: string]: unknown;
};

function gmailHeader(message: GmailSourceMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name)?.value.trim() ?? "";
}

function cleanHeader(value: string, label: string) {
  if (/\r|\n/.test(value)) throw new Error(`${label} cannot contain a line break.`);
  return value;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function calendarEventBody(input: {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  attendees?: string[];
  addGoogleMeet?: boolean;
  conferenceRequestId?: string;
}) {
  if (input.attendees) validateEmailList(input.attendees, "Attendees");
  return {
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.start ? { start: { dateTime: input.start, ...(input.timeZone ? { timeZone: input.timeZone } : {}) } } : {}),
    ...(input.end ? { end: { dateTime: input.end, ...(input.timeZone ? { timeZone: input.timeZone } : {}) } } : {}),
    ...(input.attendees ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
    ...(input.addGoogleMeet ? {
      conferenceData: {
        createRequest: {
          requestId: input.conferenceRequestId ?? crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    } : {}),
  };
}

export async function googleApi<T>(accessToken: string, url: string, init: RequestInit = {}, refreshAccessToken?: () => Promise<string | null>, attempt = 0): Promise<T> {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, cache: "no-store" });
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (response.status === 401 && attempt === 0 && refreshAccessToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return googleApi<T>(refreshed, url, init, refreshAccessToken, attempt + 1);
  }
  if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message ?? `Google API request failed (${response.status}).`);
  return payload as T;
}

function isGoogleAuthenticationError(error: unknown) {
  return error instanceof Error && /invalid authentication credentials|invalid credentials|unauthenticated|oauth 2 access token|google api request failed \(401\)/i.test(error.message);
}

export async function createGoogleToolRegistry(input: { runId: string; userId?: string; stepId: string; store: RunStore; userTimeZone?: unknown; signal?: AbortSignal; startupSnapshot?: Promise<AgentRunSnapshot | null>; connections?: { getPrimaryGoogleConnectionId: (ownerEmail: string) => Promise<string | null>; getGoogleConnectionAccessToken: typeof getGoogleConnectionAccessToken } }) {
  const connections = input.connections ?? { getPrimaryGoogleConnectionId, getGoogleConnectionAccessToken };
  const [run, secrets] = await Promise.all([
    input.startupSnapshot ?? input.store.getRun(input.runId),
    input.store.getSecrets(input.runId, ["google_connection_id", "google_access_token"]),
  ]);
  const context = run?.metadata.executionContext as { emailProvider?: unknown; sourceAccountId?: unknown } | undefined;
  const storedConnectionId = context?.emailProvider === 'icloud' && secrets.google_connection_id === context.sourceAccountId
    ? null : secrets.google_connection_id ?? null;
  const discardedICloudId = context?.emailProvider === 'icloud' && secrets.google_connection_id === context.sourceAccountId;
  const storedAccessToken = discardedICloudId ? null : secrets.google_access_token ?? null;
  const ownerEmail = input.userId ?? run?.userId ?? "";
  const userTimeZone = validTimeZone(input.userTimeZone) ?? validTimeZone(run?.metadata.userTimeZone) ?? "UTC";
  const source = sourceAccountIdOf(run?.metadata ?? {});
  const sourceAccountId = source && source !== 'session' ? source : null;
  const primaryConnectionId = !storedConnectionId && !sourceAccountId && ownerEmail
    ? await connections.getPrimaryGoogleConnectionId(ownerEmail).catch(() => null)
    : null;
  const connectionId = storedConnectionId ?? sourceAccountId ?? primaryConnectionId;
  const connectedAccessToken = connectionId ? await connections.getGoogleConnectionAccessToken(ownerEmail, connectionId).catch(() => null) : null;
  if (connectionId && connectedAccessToken) {
    if (!storedConnectionId) await input.store.putSecret(input.runId, "google_connection_id", connectionId);
    if (connectedAccessToken !== storedAccessToken) await input.store.putSecret(input.runId, "google_access_token", connectedAccessToken);
  }
  const resolvedAccessToken = connectedAccessToken ?? (!connectionId && context?.emailProvider !== "icloud" ? storedAccessToken : null);
  if (!resolvedAccessToken) return { tools: {} as ToolSet, unavailable: ["Authenticated Gmail and Calendar"] };
  let accessToken = resolvedAccessToken;
  const refreshAccessToken = connectionId ? async () => {
    const refreshed = await connections.getGoogleConnectionAccessToken(ownerEmail, connectionId, { forceRefresh: true });
    if (!refreshed) return null;
    accessToken = refreshed;
    await input.store.putSecret(input.runId, "google_access_token", refreshed);
    return refreshed;
  } : undefined;
  const withCurrentAccessToken = async <T>(operation: (token: string) => Promise<T>) => {
    try {
      return await operation(accessToken);
    } catch (error) {
      if (!refreshAccessToken || !isGoogleAuthenticationError(error)) throw error;
      const refreshed = await refreshAccessToken();
      if (!refreshed) throw error;
      return operation(refreshed);
    }
  };

  const tools: ToolSet = {
    gmail_search_messages: tool({
      description: "Search the authenticated Gmail account using Gmail search syntax, then return up to 10 complete matching messages with their stable message IDs. Also returns Gmail's exact unread inbox message and conversation counts, separately from the limited search sample. Use the inbox count, not the number of returned messages, to answer unread inbox count questions. Use this first when source context lacks a message ID. The runtime refreshes expired access tokens; an authentication or permission failure requires Google reconnect, never a browser login.",
      inputSchema: z.object({ query: z.string().min(1).max(500), maxResults: z.number().int().min(1).max(10).default(5) }),
      execute: async ({ query, maxResults }, options) => executeGuardedAction({
        runId: input.runId, stepId: input.stepId, toolName: "gmail_search_messages", risk: "read", preview: `Search Gmail for ${query}`, args: { query, maxResults }, store: input.store, signal: options.abortSignal ?? input.signal,
        execute: async () => {
          const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
          const list = await googleApi<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { signal: options.abortSignal ?? input.signal }, refreshAccessToken);
          const messages = await Promise.all((list.messages ?? []).slice(0, maxResults).map(({ id }) => withCurrentAccessToken((token) => fetchGmailMessage(token, id))));
          const inbox = await googleApi<{ messagesUnread?: number; threadsUnread?: number }>(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX", { signal: options.abortSignal ?? input.signal }, refreshAccessToken);
          const unreadMessages = inbox.messagesUnread;
          const unreadThreads = inbox.threadsUnread;
          if (typeof unreadMessages !== "number" || !Number.isSafeInteger(unreadMessages) || unreadMessages < 0 || typeof unreadThreads !== "number" || !Number.isSafeInteger(unreadThreads) || unreadThreads < 0) {
            throw new Error("Gmail did not return a valid unread inbox count.");
          }
          return { query, count: messages.length, hasMore: Boolean(list.nextPageToken), messages, unreadInbox: { messages: unreadMessages, threads: unreadThreads } };
        },
      }),
    }),
    gmail_read_message: tool({
      description: "Read the complete authenticated Gmail source message by message ID, including body, links, and attachment metadata.",
      inputSchema: z.object({ messageId: z.string().min(1).max(300) }),
      execute: async ({ messageId }, options) => executeGuardedAction({
        runId: input.runId, stepId: input.stepId, toolName: "gmail_read_message", risk: "read", preview: `Read Gmail message ${messageId}`, args: { messageId }, store: input.store, signal: options.abortSignal ?? input.signal,
        execute: async () => withCurrentAccessToken((token) => fetchGmailMessage(token, messageId)),
      }),
    }),
    gmail_download_attachment: tool({
      description: "Download an attachment from an authenticated Gmail message into the run's artifacts.",
      inputSchema: z.object({ messageId: z.string().min(1).max(300), attachmentId: z.string().min(1).max(500), filename: z.string().min(1).max(160), mimeType: z.string().min(1).max(160) }),
      execute: async ({ messageId, attachmentId, filename, mimeType }, options) => executeGuardedAction({
        runId: input.runId, stepId: input.stepId, toolName: "gmail_download_attachment", risk: "read", preview: `Download Gmail attachment ${filename}`, args: { messageId, attachmentId, filename, mimeType }, store: input.store, signal: options.abortSignal ?? input.signal,
        execute: async (_args, action) => {
          const attachment = await withCurrentAccessToken((token) => fetchGmailAttachment(token, messageId, attachmentId));
          const artifact = await input.store.createArtifact({ runId: input.runId, actionId: action.id, name: cleanFilename(filename), mimeType, bytesBase64: attachment.bytes.toString("base64") });
          return { artifact: { id: artifact.id, name: artifact.name, mimeType: artifact.mimeType }, size: attachment.size };
        },
      }),
    }),
    gmail_create_draft: tool({
      description: "Create a reversible Gmail draft. To show a draft or revision inline, next call gmail_send_draft using these exact returned draft details; this presents the existing review card without automatic sending. Do not paste the email body into ordinary chat. When replying to a source email, pass replyToMessageId; the tool preserves its Gmail thread and RFC reply headers.",
      inputSchema: z.object({ to: z.array(z.string().min(3).max(320)).min(1).max(20), cc: z.array(z.string().min(3).max(320)).max(20).default([]), subject: z.string().min(1).max(300), body: z.string().min(1).max(30_000), threadId: z.string().max(300).optional(), replyToMessageId: z.string().max(300).optional() }),
      execute: async ({ to, cc, subject, body, threadId, replyToMessageId }, options) => {
        validateEmailList(to, "To");
        validateEmailList(cc, "Cc");
        cleanHeader(subject, "Subject");
        return executeGuardedAction({
          runId: input.runId, stepId: input.stepId, toolName: "gmail_create_draft", risk: "write_reversible", dedupeAcrossSteps: true, preview: `Create Gmail draft\nTo: ${to.join(", ")}\n${cc.length ? `Cc: ${cc.join(", ")}\n` : ""}Subject: ${subject}\n\n${body}`, args: { to, cc, subject, body, threadId, replyToMessageId }, store: input.store, signal: options.abortSignal ?? input.signal,
          execute: async () => {
            const source = replyToMessageId
              ? await googleApi<GmailSourceMessage>(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodedPath(replyToMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`, { signal: options.abortSignal ?? input.signal }, refreshAccessToken)
              : null;
            const sourceMessageId = source ? gmailHeader(source, "message-id") : "";
            const sourceReferences = source ? gmailHeader(source, "references") : "";
            const resolvedThreadId = source?.threadId ?? threadId;
            const references = [sourceReferences, sourceMessageId].filter(Boolean).join(" ");
            const raw = [
              `To: ${to.join(", ")}`,
              ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
              `Subject: ${subject}`,
              ...(sourceMessageId ? [`In-Reply-To: ${sourceMessageId}`] : []),
              ...(references ? [`References: ${references}`] : []),
              "MIME-Version: 1.0",
              "Content-Type: text/plain; charset=UTF-8",
              "",
              body,
            ].join("\r\n");
            const draft = await googleApi<{ id: string; message?: { id?: string; threadId?: string } }>(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: JSON.stringify({ message: { raw: base64url(raw), ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}) } }), signal: options.abortSignal ?? input.signal }, refreshAccessToken);
            return { draftId: draft.id, messageId: draft.message?.id ?? null, threadId: draft.message?.threadId ?? resolvedThreadId ?? null, to, cc, subject, body, replyToMessageId: replyToMessageId ?? null };
          },
        });
      },
    }),
    gmail_send_draft: tool({
      description: "Propose sending an existing Gmail draft through the inline email component. For displaying a draft, demo or revision, call this tool with the saved draft details. It presents the inline review card; nothing is sent until the user explicitly approves. Do not paste draft bodies into chat. Every email send requires explicit user review; saved reusable email approvals are ignored.",
      inputSchema: z.object({ draftId: z.string().min(1).max(300), to: z.array(z.string().min(3).max(320)).min(1).max(20), subject: z.string().min(1).max(300), body: z.string().min(1).max(30_000) }),
      execute: async ({ draftId, to, subject, body }, options) => {
        validateEmailList(to, "To");
        return executeGuardedAction({
          runId: input.runId, stepId: input.stepId, toolName: "gmail_send_draft", risk: "write_external", authorization: "selected_option", alwaysApproved: false, preview: `Send Gmail draft\nTo: ${to.join(", ")}\nSubject: ${subject}\n\n${body}`, args: { draftId, to, subject, body }, store: input.store, signal: options.abortSignal ?? input.signal,
          execute: async (_args, action) => {
            const edit = action.result?.approvedEmailEdit;
            if (edit !== undefined) {
              const approvedEdit = emailDraftEditSchema.parse(edit);
              const draft = await googleApi<{ message?: { raw?: string; threadId?: string } }>(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodedPath(draftId)}?format=raw`, { signal: options.abortSignal ?? input.signal }, refreshAccessToken);
              if (!draft.message?.raw) throw new Error("The email draft could not be loaded. Nothing was sent.");
              const raw = editedDraftRaw(draft.message.raw, approvedEdit);
              await googleApi(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodedPath(draftId)}`, { method: "PUT", body: JSON.stringify({ message: { raw, ...(draft.message.threadId ? { threadId: draft.message.threadId } : {}) } }), signal: options.abortSignal ?? input.signal }, refreshAccessToken);
            }
            const result = await googleApi<Record<string, unknown>>(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", { method: "POST", body: JSON.stringify({ id: draftId }), signal: options.abortSignal ?? input.signal }, refreshAccessToken);
            return { ...result, ...(edit !== undefined ? { approvedEmailEdit: edit } : {}) };
          },
        });
      },
    }),
    calendar_get_event: tool({
      description: "Read an authenticated event from the user's primary Google Calendar. Use userLocalTime for dates and times in replies; it is already converted to the user timezone.",
      inputSchema: z.object({ eventId: z.string().min(1).max(1024) }),
      execute: async ({ eventId }, options) => executeGuardedAction({
        runId: input.runId, stepId: input.stepId, toolName: "calendar_get_event", risk: "read", preview: `Read Calendar event ${eventId}`, args: { eventId }, store: input.store, signal: options.abortSignal ?? input.signal,
        execute: async () => withCalendarLocalTime(await googleApi<Record<string, unknown>>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedPath(eventId)}`, { signal: options.abortSignal ?? input.signal }, refreshAccessToken), userTimeZone),
      }),
    }),
    calendar_search_events: tool({
      description: "Search and list events from the user's primary Google Calendar in a time range. Use this to find an event ID before reading, updating, or deleting an event. Use each event's userLocalTime for dates and times in replies; do not convert it again.",
      inputSchema: z.object({
        timeMin: eventDateTimeSchema,
        timeMax: eventDateTimeSchema,
        query: z.string().max(500).optional(),
        maxResults: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ timeMin, timeMax, query, maxResults }, options) => executeGuardedAction({
        runId: input.runId, stepId: input.stepId, toolName: "calendar_search_events", risk: "read", preview: `Search Calendar from ${timeMin} to ${timeMax}${query ? ` for ${query}` : ""}`, args: { timeMin, timeMax, query, maxResults }, store: input.store, signal: options.abortSignal ?? input.signal,
        execute: async () => {
          const params = new URLSearchParams({ timeMin, timeMax, maxResults: String(maxResults), singleEvents: "true", orderBy: "startTime", timeZone: userTimeZone });
          if (query) params.set("q", query);
          const result = await googleApi<Record<string, unknown>>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { signal: options.abortSignal ?? input.signal }, refreshAccessToken);
          return { ...result, items: Array.isArray(result.items) ? result.items.map(event => withCalendarLocalTime(event, userTimeZone)) : [] };
        },
      }),
    }),
    calendar_create_event: tool({
      description: "Create an event on the user's primary Google Calendar as the exact calendar action authorized by the current direct user request or selected card option. The authenticated user is automatically the organizer and a participant. For a remote call or meeting, set addGoogleMeet=true; a unique Google Meet is generated and returned. Guests receive Calendar invitations. Execute the authorized calendar action directly; no additional approval is required.",
      inputSchema: z.object(eventFieldsSchema).refine(({ start, end }) => new Date(end).getTime() > new Date(start).getTime(), { message: "Event end must be after its start." }),
      execute: async ({ summary, description, location, start, end, timeZone, attendees, addGoogleMeet }, options) => {
        const includeGoogleMeet = addGoogleMeet ?? (attendees.length > 0 && !location);
        const scope = (await input.store.getRun(input.runId))?.metadata.actionScopeId ?? null;
        const conferenceRequestId = createHash("sha256").update(JSON.stringify([input.runId, scope, summary, description, location, start, end, timeZone, attendees])).digest("hex");
        const event = calendarEventBody({ summary, description, location, start, end, timeZone, attendees, addGoogleMeet: includeGoogleMeet, conferenceRequestId });
        return executeGuardedAction({
          runId: input.runId, stepId: input.stepId, toolName: "calendar_create_event", risk: "write_external", authorization: "selected_option", preview: calendarApprovalPreview("Create Calendar event", event), args: { event }, store: input.store, signal: options.abortSignal ?? input.signal,
          execute: async () => {
            const params = new URLSearchParams({ sendUpdates: "all", ...(includeGoogleMeet ? { conferenceDataVersion: "1" } : {}) });
            let created = await googleApi<GoogleCalendarEvent>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { method: "POST", body: JSON.stringify(event), signal: options.abortSignal ?? input.signal }, refreshAccessToken);
            if (includeGoogleMeet && created.id && !created.hangoutLink) {
              const eventId = created.id;
              for (let attempt = 0; attempt < 5 && !created.hangoutLink; attempt += 1) {
                await wait(250 * (attempt + 1));
                created = await googleApi<GoogleCalendarEvent>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedPath(eventId)}`, { signal: options.abortSignal ?? input.signal }, refreshAccessToken);
                if (created.conferenceData?.createRequest?.status?.statusCode === "failure") throw new Error("Google Calendar could not create the Google Meet conference.");
              }
            }
            const run = await input.store.getRun(input.runId);
            return { ...created, organizerEmail: created.organizer?.email ?? run?.userId ?? null, googleMeetUrl: created.hangoutLink ?? created.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ?? null };
          },
        });
      },
    }),
    calendar_update_event: tool({
      description: "Update an authenticated Google Calendar event as the exact calendar action authorized by the current direct user request or selected card option. To accept, decline, or tentatively accept an invitation for the signed-in user, set selfResponseStatus only for an explicitly requested invitation response. Omit it when changing time, title, location, or other event details; the tool preserves the other attendees and verifies the new RSVP. Execute the authorized calendar action directly; no additional approval is required.",
      inputSchema: z.object({ eventId: z.string().min(1).max(1024), summary: z.string().min(1).max(500).optional(), description: z.string().max(10_000).optional(), location: z.string().max(1000).optional(), start: eventDateTimeSchema.optional(), end: eventDateTimeSchema.optional(), timeZone: z.string().min(1).max(100).optional(), attendees: z.array(z.string().min(3).max(320)).max(50).optional(), selfResponseStatus: z.enum(["accepted", "declined", "tentative"]).optional() }).refine((value) => Object.keys(value).some((key) => key !== "eventId" && value[key as keyof typeof value] !== undefined), { message: "At least one event change is required." }).refine(({ start, end }) => !start || !end || new Date(end).getTime() > new Date(start).getTime(), { message: "Event end must be after its start." }),
      execute: async ({ eventId, summary, description, location, start, end, timeZone, attendees, selfResponseStatus }, options) => {
        const changes = calendarEventBody({ summary, description, location, start, end, timeZone, attendees });
        return executeGuardedAction({
          runId: input.runId, stepId: input.stepId, toolName: "calendar_update_event", risk: "write_external", authorization: "selected_option", preview: calendarApprovalPreview("Update Calendar event", { ...changes, ...(selfResponseStatus ? { selfResponseStatus } : {}) }), args: { eventId, changes, selfResponseStatus }, store: input.store, signal: options.abortSignal ?? input.signal,
          execute: async () => {
            let eventChanges: Record<string, unknown> = changes;
            let selfEmail: string | null = null;
            let rsvpApplied = false;
            if (selfResponseStatus) {
              const current = await googleApi<GoogleCalendarEvent>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedPath(eventId)}`, { signal: options.abortSignal ?? input.signal }, refreshAccessToken);
              const run = await input.store.getRun(input.runId);
              const selfIndex = current.attendees?.findIndex((attendee) => attendee.self || attendee.email?.toLowerCase() === run?.userId.toLowerCase()) ?? -1;
              const personalOrganizer = current.organizer?.self === true && !current.attendees?.length;
              // Personal events have no invitation to accept. Preserve the approved
              // field edits without manufacturing an attendee or blocking the update.
              if (selfIndex < 0 && personalOrganizer && selfResponseStatus === "accepted" && Object.keys(changes).length > 0) {
                eventChanges = changes;
              } else {
                if (selfIndex < 0 || !current.attendees) throw new Error("The signed-in user is not listed as an attendee on this event.");
                selfEmail = current.attendees[selfIndex]?.email ?? null;
                if (!selfEmail) throw new Error("Google Calendar did not return an email address for the signed-in attendee.");
                eventChanges = {
                  ...changes,
                  attendees: [{ email: selfEmail, responseStatus: selfResponseStatus }],
                  attendeesOmitted: true,
              };
              rsvpApplied = true;
              }
            }
            const params = new URLSearchParams({ sendUpdates: "all" });
            const updated = await googleApi<GoogleCalendarEvent>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedPath(eventId)}?${params}`, { method: "PATCH", body: JSON.stringify(eventChanges), signal: options.abortSignal ?? input.signal }, refreshAccessToken);
            if (rsvpApplied && !updated.attendees?.some((attendee) => (attendee.self || attendee.email?.toLowerCase() === selfEmail?.toLowerCase()) && attendee.responseStatus === selfResponseStatus)) {
              throw new Error("Google Calendar did not confirm the requested RSVP change.");
            }
            return { ...updated, ...(rsvpApplied ? { selfResponseStatus } : {}) };
          },
        });
      },
    }),
    calendar_delete_event: tool({
      description: "Delete an event from the user's primary Google Calendar as the exact calendar action authorized by the current direct user request or selected card option. Execute the authorized calendar action directly; no additional approval is required.",
      inputSchema: z.object({ eventId: z.string().min(1).max(1024) }),
      execute: async ({ eventId }, options) => executeGuardedAction({
        runId: input.runId, stepId: input.stepId, toolName: "calendar_delete_event", risk: "write_external", authorization: "selected_option", preview: `Delete Calendar event ${eventId}`, args: { eventId }, store: input.store, signal: options.abortSignal ?? input.signal,
        execute: async () => {
          await googleApi<unknown>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedPath(eventId)}`, { method: "DELETE", signal: options.abortSignal ?? input.signal }, refreshAccessToken);
          return { deleted: true, eventId };
        },
      }),
    }),
  };
  return { tools, unavailable: [] as string[] };
}
