import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { discoveryScanStates } from "../../db/schema";
import type { DecisionEmailInput } from "../agent";

const MAX_REMEMBERED_MESSAGES = 2_000;

type UserScanState = {
  initializedAt: string;
  updatedAt: string;
  gmailHistoryId?: string;
  reviewedMessageIds: string[];
  recentEmails: DecisionEmailInput[];
};

function userKey(userId: string) {
  return createHash("sha256").update(userId.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export async function getDiscoveryScanState(userId: string): Promise<UserScanState | null> {
  const [selected] = await getDb().select().from(discoveryScanStates)
    .where(eq(discoveryScanStates.userKey, userKey(userId))).limit(1);
  if (!selected) return null;
  return {
    initializedAt: selected.initializedAt.toISOString(),
    updatedAt: selected.updatedAt.toISOString(),
    gmailHistoryId: selected.gmailHistoryId ?? undefined,
    reviewedMessageIds: Array.isArray(selected.reviewedMessageIds) ? selected.reviewedMessageIds : [],
    recentEmails: Array.isArray(selected.recentEmails) ? selected.recentEmails : [],
  };
}

function compactEmail(email: DecisionEmailInput): DecisionEmailInput {
  return {
    ...email,
    subject: email.subject.slice(0, 500),
    from: email.from.slice(0, 500),
    to: email.to.slice(0, 1_000),
    snippet: email.snippet.slice(0, 2_000),
    body: email.body.slice(0, 12_000),
    links: email.links.slice(0, 50),
    confirmationNumbers: email.confirmationNumbers.slice(0, 30),
    attachments: email.attachments.slice(0, 20),
  };
}

export async function rememberReviewedMessages(userId: string, messageIds: string[], recentEmails: DecisionEmailInput[] = [], gmailHistoryId?: string) {
  if (messageIds.length === 0 && !gmailHistoryId) return;
  const key = userKey(userId);
  const existing = await getDiscoveryScanState(userId);
  const reviewedMessageIds = [...new Set([...(existing?.reviewedMessageIds ?? []), ...messageIds])].slice(-MAX_REMEMBERED_MESSAGES);
  const emailById = new Map([...(existing?.recentEmails ?? []), ...recentEmails].map((email) => [email.id, compactEmail(email)]));
  const orderedIds = [...recentEmails.map((email) => email.id), ...(existing?.recentEmails ?? []).map((email) => email.id)];
  const cachedIds = [...new Set(orderedIds)].slice(0, 150);
  const cachedEmails = cachedIds.flatMap((emailId) => emailById.get(emailId) ? [emailById.get(emailId)!] : []);
  const now = new Date();
  await getDb().insert(discoveryScanStates).values({
    userKey: key,
    gmailHistoryId: gmailHistoryId ?? existing?.gmailHistoryId,
    reviewedMessageIds,
    recentEmails: cachedEmails,
    initializedAt: existing?.initializedAt ? new Date(existing.initializedAt) : now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: discoveryScanStates.userKey,
    set: {
      gmailHistoryId: gmailHistoryId ?? existing?.gmailHistoryId,
      reviewedMessageIds,
      recentEmails: cachedEmails,
      updatedAt: now,
    },
  });
}
