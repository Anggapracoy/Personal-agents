import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { connectedGoogleAccounts, googleSourceWatches } from "../db/schema";
import { getGoogleConnectionAccessToken } from "./auth/google-connections";

const RENEW_BEFORE_MS = 48 * 60 * 60 * 1000;
const CALENDAR_TTL_SECONDS = 7 * 24 * 60 * 60;

type GmailWatchResponse = { historyId?: string; expiration?: string };
type CalendarWatchResponse = { id?: string; resourceId?: string; expiration?: string };

export type GoogleWatchContext = {
  connectionId: string;
  ownerEmail: string;
  accountEmail: string;
  enabled: boolean;
  gmailHistoryId: string | null;
  calendarChannelId: string | null;
  calendarResourceId: string | null;
};

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function pushEnabled() {
  return process.env.ENABLE_GOOGLE_PUSH === "true";
}

function pushBaseUrl() {
  const configured = process.env.GOOGLE_PUSH_BASE_URL?.trim().replace(/\/$/, "");
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function expiration(value?: string) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > Date.now() ? new Date(milliseconds) : null;
}

function needsRenewal(value: Date | null) {
  return !value || value.getTime() <= Date.now() + RENEW_BEFORE_MS;
}

async function googlePost<T>(url: string, accessToken: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google watch request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export function secureStringEqual(actual: string | null | undefined, expected: string | null | undefined) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function calendarChannelToken(connectionId: string) {
  const secret = process.env.GOOGLE_CALENDAR_WEBHOOK_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(connectionId).digest("base64url");
}

export function decodeGmailPubSubMessage(value: unknown) {
  function decodeCandidate(candidate: unknown, messageId: string | null, depth: number): {
    emailAddress: string;
    historyId: string;
    messageId: string | null;
  } | null {
    if (depth > 3 || candidate == null) return null;
    if (typeof candidate === "string") {
      try {
        return decodeCandidate(JSON.parse(candidate), messageId, depth + 1);
      } catch {
        try {
          const decoded = Buffer.from(candidate, "base64url").toString("utf8");
          if (!decoded || decoded === candidate) return null;
          return decodeCandidate(JSON.parse(decoded), messageId, depth + 1);
        } catch {
          return null;
        }
      }
    }
    if (typeof candidate !== "object") return null;

    const object = candidate as {
      emailAddress?: unknown;
      historyId?: unknown;
      data?: unknown;
      message?: { data?: unknown; messageId?: unknown; message_id?: unknown };
    };
    const historyId = typeof object.historyId === "string"
      ? object.historyId
      : typeof object.historyId === "number" && Number.isSafeInteger(object.historyId)
        ? String(object.historyId)
        : null;
    if (typeof object.emailAddress === "string" && historyId && /^\d+$/.test(historyId)) {
      return { emailAddress: normalizedEmail(object.emailAddress), historyId, messageId };
    }
    if (object.message) {
      const nestedMessageId = typeof object.message.messageId === "string"
        ? object.message.messageId
        : typeof object.message.message_id === "string"
          ? object.message.message_id
          : messageId;
      return decodeCandidate(object.message.data, nestedMessageId, depth + 1);
    }
    if (object.data != null) return decodeCandidate(object.data, messageId, depth + 1);
    return null;
  }

  return decodeCandidate(value, null, 0);
}

export async function getGoogleWatchContext(connectionId: string): Promise<GoogleWatchContext | null> {
  const [row] = await getDb().select({
    connectionId: connectedGoogleAccounts.id,
    ownerEmail: connectedGoogleAccounts.ownerEmail,
    accountEmail: connectedGoogleAccounts.email,
    enabled: connectedGoogleAccounts.enabled,
    gmailHistoryId: googleSourceWatches.gmailHistoryId,
    calendarChannelId: googleSourceWatches.calendarChannelId,
    calendarResourceId: googleSourceWatches.calendarResourceId,
  }).from(connectedGoogleAccounts).leftJoin(
    googleSourceWatches,
    eq(googleSourceWatches.connectionId, connectedGoogleAccounts.id),
  ).where(eq(connectedGoogleAccounts.id, connectionId)).limit(1);
  return row ?? null;
}

export async function findGoogleWatchContextsByAccountEmail(accountEmailInput: string) {
  const accountEmail = normalizedEmail(accountEmailInput);
  return getDb().select({
    connectionId: connectedGoogleAccounts.id,
    ownerEmail: connectedGoogleAccounts.ownerEmail,
    accountEmail: connectedGoogleAccounts.email,
    enabled: connectedGoogleAccounts.enabled,
    gmailHistoryId: googleSourceWatches.gmailHistoryId,
    calendarChannelId: googleSourceWatches.calendarChannelId,
    calendarResourceId: googleSourceWatches.calendarResourceId,
  }).from(connectedGoogleAccounts).innerJoin(
    googleSourceWatches,
    eq(googleSourceWatches.connectionId, connectedGoogleAccounts.id),
  ).where(and(
    eq(connectedGoogleAccounts.email, accountEmail),
    eq(connectedGoogleAccounts.enabled, true),
  ));
}

export async function getGoogleWatchContextByCalendarChannel(channelId: string) {
  const [row] = await getDb().select({
    connectionId: connectedGoogleAccounts.id,
    ownerEmail: connectedGoogleAccounts.ownerEmail,
    accountEmail: connectedGoogleAccounts.email,
    enabled: connectedGoogleAccounts.enabled,
    gmailHistoryId: googleSourceWatches.gmailHistoryId,
    calendarChannelId: googleSourceWatches.calendarChannelId,
    calendarResourceId: googleSourceWatches.calendarResourceId,
  }).from(googleSourceWatches).innerJoin(
    connectedGoogleAccounts,
    eq(connectedGoogleAccounts.id, googleSourceWatches.connectionId),
  ).where(and(
    eq(googleSourceWatches.calendarChannelId, channelId),
    eq(connectedGoogleAccounts.enabled, true),
  )).limit(1);
  return row ?? null;
}

export async function ensureGoogleSourceWatches(connectionId: string, force = false) {
  if (!pushEnabled()) return { connectionId, gmail: "disabled", calendar: "disabled" };
  const db = getDb();
  const [account] = await db.select().from(connectedGoogleAccounts)
    .where(and(eq(connectedGoogleAccounts.id, connectionId), eq(connectedGoogleAccounts.enabled, true))).limit(1);
  if (!account) return { connectionId, gmail: "missing", calendar: "missing" };
  const accessToken = await getGoogleConnectionAccessToken(account.ownerEmail, account.id);
  if (!accessToken) throw new Error(`Google access for ${account.email} could not be refreshed.`);
  const now = new Date();
  await db.insert(googleSourceWatches).values({
    connectionId: account.id,
    ownerEmail: account.ownerEmail,
    accountEmail: account.email,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: googleSourceWatches.connectionId,
    set: { ownerEmail: account.ownerEmail, accountEmail: account.email, updatedAt: now },
  });
  const [watch] = await db.select().from(googleSourceWatches)
    .where(eq(googleSourceWatches.connectionId, account.id)).limit(1);
  let gmail: "ready" | "unchanged" | "unconfigured" = "unconfigured";
  let calendar: "ready" | "unchanged" | "unconfigured" = "unconfigured";
  const failures: string[] = [];

  const topicName = process.env.GOOGLE_GMAIL_PUBSUB_TOPIC?.trim();
  if (topicName) {
    if (force || (watch?.gmailWatchVersion ?? 1) < 2 || needsRenewal(watch?.gmailWatchExpiresAt ?? null)) {
      try {
        const result = await googlePost<GmailWatchResponse>(
          "https://gmail.googleapis.com/gmail/v1/users/me/watch",
          accessToken,
          { topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "INCLUDE" },
        );
        if (!result.historyId || !/^\d+$/.test(result.historyId)) throw new Error("Gmail watch did not return a history cursor.");
        await db.update(googleSourceWatches).set({
          gmailWatchVersion: 2,
          gmailHistoryId: sql`COALESCE(${googleSourceWatches.gmailHistoryId}, ${result.historyId})`,
          gmailWatchExpiresAt: expiration(result.expiration),
          lastError: null,
          updatedAt: new Date(),
        }).where(eq(googleSourceWatches.connectionId, account.id));
        gmail = "ready";
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Gmail watch registration failed.");
      }
    } else gmail = "unchanged";
  }

  const baseUrl = pushBaseUrl();
  const channelToken = calendarChannelToken(account.id);
  if (baseUrl && channelToken) {
    if (force || needsRenewal(watch?.calendarWatchExpiresAt ?? null)) {
      try {
        const channelId = randomUUID();
        const result = await googlePost<CalendarWatchResponse>(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
          accessToken,
          {
            id: channelId,
            type: "web_hook",
            address: `${baseUrl}/api/webhooks/google/calendar`,
            token: channelToken,
            params: { ttl: String(CALENDAR_TTL_SECONDS) },
          },
        );
        if (!result.resourceId) throw new Error("Google Calendar watch did not return a resource id.");
        await db.update(googleSourceWatches).set({
          calendarChannelId: result.id ?? channelId,
          calendarResourceId: result.resourceId,
          calendarWatchExpiresAt: expiration(result.expiration),
          lastError: null,
          updatedAt: new Date(),
        }).where(eq(googleSourceWatches.connectionId, account.id));
        if (watch?.calendarChannelId && watch.calendarResourceId) {
          await googlePost("https://www.googleapis.com/calendar/v3/channels/stop", accessToken, {
            id: watch.calendarChannelId,
            resourceId: watch.calendarResourceId,
          }).catch(() => undefined);
        }
        calendar = "ready";
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Google Calendar watch registration failed.");
      }
    } else calendar = "unchanged";
  }

  if (failures.length) {
    await db.update(googleSourceWatches).set({ lastError: failures.join(" ").slice(0, 2_000), updatedAt: new Date() })
      .where(eq(googleSourceWatches.connectionId, account.id));
  }
  return { connectionId, gmail, calendar, failures };
}

export async function ensureAllGoogleSourceWatches() {
  if (!pushEnabled()) return [];
  const accounts = await getDb().select({ id: connectedGoogleAccounts.id })
    .from(connectedGoogleAccounts)
    .where(eq(connectedGoogleAccounts.enabled, true))
    .orderBy(asc(connectedGoogleAccounts.createdAt));
  const results: Array<{ connectionId: string; gmail: string; calendar: string; failures?: string[] }> = [];
  for (let index = 0; index < accounts.length; index += 3) {
    results.push(...await Promise.all(accounts.slice(index, index + 3).map((account) => ensureGoogleSourceWatches(account.id).catch((error) => ({
      connectionId: account.id,
      gmail: "missing" as const,
      calendar: "missing" as const,
      failures: [error instanceof Error ? error.message : "Watch renewal failed."],
    })))));
  }
  return results;
}

export async function stopGoogleSourceWatches(connectionId: string) {
  const context = await getGoogleWatchContext(connectionId);
  if (!context) return;
  const accessToken = await getGoogleConnectionAccessToken(context.ownerEmail, connectionId);
  if (accessToken) {
    // Gmail permits one watch per mailbox/project. Let it expire naturally so
    // disabling one app account cannot interrupt another owner using the same
    // Google mailbox. Calendar channels are unique and can be stopped safely.
    if (context.calendarChannelId && context.calendarResourceId) {
      await googlePost("https://www.googleapis.com/calendar/v3/channels/stop", accessToken, {
        id: context.calendarChannelId,
        resourceId: context.calendarResourceId,
      }).catch(() => undefined);
    }
  }
  await getDb().delete(googleSourceWatches).where(eq(googleSourceWatches.connectionId, connectionId));
}

export async function recordGoogleSourceNotification(connectionId: string, source: "gmail" | "calendar") {
  const now = new Date();
  await getDb().update(googleSourceWatches).set({
    ...(source === "gmail" ? { lastGmailNotificationAt: now } : { lastCalendarNotificationAt: now }),
    updatedAt: now,
  }).where(eq(googleSourceWatches.connectionId, connectionId));
}

export async function recordGoogleSourceProcessed(connectionId: string, input: { gmailHistoryId?: string; error?: string | null }) {
  await getDb().update(googleSourceWatches).set({
    ...(input.gmailHistoryId ? { gmailHistoryId: input.gmailHistoryId } : {}),
    lastProcessedAt: new Date(),
    lastError: input.error ?? null,
    updatedAt: new Date(),
  }).where(eq(googleSourceWatches.connectionId, connectionId));
}

export async function recordGoogleSourceError(connectionId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await getDb().update(googleSourceWatches).set({ lastError: message.slice(0, 2_000), updatedAt: new Date() })
    .where(eq(googleSourceWatches.connectionId, connectionId));
}
