import assert from "node:assert/strict";
import test from "node:test";
import { reconcileDiscoveredConversations } from "../lib/discovery/decision-merge";
import type { Decision } from "../lib/types";

function decision(input: { id: string; fingerprint: string; threadId: string; title: string; createdAt?: string }): Decision {
  return {
    id: input.id,
    discoveryFingerprint: input.fingerprint,
    sourceType: "email",
    category: "social",
    urgency: "medium",
    title: input.title,
    subtitle: input.title,
    originalContext: input.title,
    executionContext: {
      sourceEmail: {
        messageId: `${input.id}-message`,
        threadId: input.threadId,
        from: "sender@example.com",
        to: "user@example.com",
        subject: input.title,
        date: "Tue, 18 Aug 2026 18:00:00 -0400",
        snippet: input.title,
        body: input.title,
        links: [],
        confirmationNumbers: [],
        attachments: [],
      },
    },
    options: [],
    dismissLabel: "Not now",
    createdAt: input.createdAt ?? "2026-08-18T22:00:00.000Z",
  };
}

test("a new real-world incident in an existing Gmail thread becomes a new card", () => {
  const original = decision({ id: "openai", fingerprint: "incident:openai", threadId: "shared-thread", title: "Resolve OpenAI limits" });
  const discovered = decision({ id: "ben", fingerprint: "incident:ben-meeting", threadId: "shared-thread", title: "Meet Ben Friday" });
  const result = reconcileDiscoveredConversations([original], [discovered]);

  assert.deepEqual(result.refreshedCurrent, [original]);
  assert.deepEqual(result.unmatchedDiscovered, [discovered]);
});

test("a true follow-up to the same incident refreshes in place without becoming a new card", () => {
  const original = decision({ id: "legacy-id", fingerprint: "incident:ben-meeting", threadId: "ben-thread", title: "Meet Ben", createdAt: "2026-08-18T18:00:00.000Z" });
  const update = decision({ id: "stable-id", fingerprint: "incident:ben-meeting", threadId: "ben-thread", title: "Meet Ben Friday" });
  const result = reconcileDiscoveredConversations([original], [update]);

  assert.equal(result.refreshedCurrent[0]?.id, "legacy-id");
  assert.equal(result.refreshedCurrent[0]?.title, "Meet Ben Friday");
  assert.equal(result.refreshedCurrent[0]?.createdAt, "2026-08-18T18:00:00.000Z");
  assert.deepEqual(result.unmatchedDiscovered, []);
});

test("a changed scheduling proposal updates the existing invite across Gmail threads and alerts once", () => {
  const original = decision({ id: "invite", fingerprint: "incident:original", threadId: "calendar-invite", title: "Wednesday call" });
  const reply = { ...decision({ id: "reply", fingerprint: "incident:reschedule", threadId: "human-reply", title: "Friday call" }), discoveryUpdatesDecisionId: original.id };
  const result = reconcileDiscoveredConversations([original], [reply]);
  assert.equal(result.refreshedCurrent.length, 1);
  assert.equal(result.refreshedCurrent[0].id, original.id);
  assert.equal(result.refreshedCurrent[0].title, "Friday call");
  assert.equal(result.refreshedCurrent[0].discoveryFingerprint, original.discoveryFingerprint);
  assert.equal(result.refreshedCurrent[0].executionContext?.sourceEmail?.threadId, "human-reply");
  assert.equal(result.updatedDecisions.length, 1);
  assert.equal(result.unmatchedDiscovered.length, 0);
  const replay = reconcileDiscoveredConversations(result.refreshedCurrent, [reply]);
  assert.deepEqual(replay.refreshedCurrent, result.refreshedCurrent);
  assert.equal(replay.updatedDecisions.length, 0);
});

test("a stale reply cannot roll back a newer proposal", () => {
  const original = decision({ id: "invite", fingerprint: "incident:meeting", threadId: "thread", title: "Latest proposal" });
  original.executionContext!.sourceEmail!.date = "2026-09-23T15:30:00Z";
  const reply = { ...decision({ id: "reply", fingerprint: "incident:meeting", threadId: "thread", title: "Old proposal" }), discoveryUpdatesDecisionId: original.id };
  const result = reconcileDiscoveredConversations([original], [reply]);
  assert.deepEqual(result.refreshedCurrent, [original]);
  assert.equal(result.updatedDecisions.length, 0);
});

test("missing or different-account update targets never create a duplicate", () => {
  const original = decision({ id: "invite", fingerprint: "incident:meeting", threadId: "thread", title: "Call" });
  const reply = { ...decision({ id: "reply", fingerprint: "incident:meeting", threadId: "other-thread", title: "New time" }), discoveryUpdatesDecisionId: original.id };
  reply.executionContext!.sourceAccountId = "different-account";
  for (const current of [[], [original]]) {
    const result = reconcileDiscoveredConversations(current, [reply]);
    assert.deepEqual(result.refreshedCurrent, current);
    assert.equal(result.updatedDecisions.length, 0);
    assert.equal(result.unmatchedDiscovered.length, 0);
  }
});

test("manual scan refreshes the same conversation and a replay cannot add a duplicate", async () => {
  const { mergeScannedDecisions } = await import('../app/workspace-model');
  const original = decision({ id: 'invite', fingerprint: 'incident:old', threadId: 'invite-thread', title: 'Wednesday' });
  const reply = { ...decision({ id: 'reply', fingerprint: 'incident:new', threadId: 'reply-thread', title: 'Friday' }), discoveryUpdatesDecisionId: original.id };
  const updated = mergeScannedDecisions([original], [reply]);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, original.id);
  assert.equal(updated[0].title, 'Friday');
  assert.deepEqual(mergeScannedDecisions(updated, [reply]), updated);
  assert.deepEqual(mergeScannedDecisions([original], [reply], ['invite']), [original]);
});
