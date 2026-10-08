import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { sanitizeConversationIdentity, suggestConversationIdentity } from "../lib/harness/conversation-identity";
import { withConversationIdentity, reconcileConversationIdentities } from "../lib/conversation-identity";
import type { Category, Decision } from "../lib/types";

const prompt = "Can you find me flights to NYC next Friday?";
const identity = { title: "NYC Flights", category: "travel" as const };
const owner = "owner@example.com";
async function pending(store: MemoryRunStore) {
  return store.createRun({ userId: owner, decisionId: null, category: "social", title: prompt, request: prompt,
    metadata: { sourceType: "manual", initialConversationTitle: prompt, retryDecision: { title: prompt, category: "social", executionContext: { sourceAccountId: "work" } } } });
}

test("manual chat identity uses the first stored request and is saved only once", async () => {
  const store = new MemoryRunStore(); const run = await pending(store); let calls = 0;
  const generate = async (request: string) => { calls++; assert.equal(request, prompt); return identity; };
  assert.deepEqual(await suggestConversationIdentity(store, run.id, owner, generate), identity);
  assert.equal(await suggestConversationIdentity(store, run.id, owner, generate), null);
  assert.equal(calls, 1);
  const saved = await store.getRun(run.id);
  assert.equal(saved?.title, "NYC Flights"); assert.equal(saved?.category, "travel");
  assert.equal((saved?.metadata.retryDecision as Decision).executionContext?.sourceAccountId, "work");
  assert.equal((saved?.metadata.retryDecision as Decision).category, "travel");
});

test("a title renamed while Luna runs is never overwritten", async () => {
  const store = new MemoryRunStore(); const run = await pending(store);
  const result = await suggestConversationIdentity(store, run.id, owner, async () => {
    await store.updateRun(run.id, { title: "My Trip" }); return identity;
  });
  assert.equal(result, null); assert.equal((await store.getRun(run.id))?.title, "My Trip");
});

test("concurrent completion and metadata updates survive naming", async () => {
  const store = new MemoryRunStore(); const run = await pending(store);
  await suggestConversationIdentity(store, run.id, owner, async () => {
    await store.updateRun(run.id, { status: "done", response: "Here are your options" });
    await store.updateRunMetadata(run.id, { actionScopeId: "current-occurrence" }); return identity;
  });
  const saved = await store.getRun(run.id);
  assert.equal(saved?.status, "done"); assert.equal(saved?.response, "Here are your options");
  assert.equal(saved?.metadata.actionScopeId, "current-occurrence");
});

test("failed naming, foreign owners and existing proactive titles leave the run intact", async () => {
  const store = new MemoryRunStore(); const run = await pending(store); let calls = 0;
  const generate = async () => { calls++; return null; };
  assert.equal(await suggestConversationIdentity(store, run.id, "other@example.com", generate), null);
  assert.equal(calls, 0);
  assert.equal(await suggestConversationIdentity(store, run.id, owner, generate), null);
  assert.equal((await store.getRun(run.id))?.title, prompt);
  await store.updateRunMetadata(run.id, { sourceType: "proactive" });
  assert.equal(await suggestConversationIdentity(store, run.id, owner, generate), null);
  assert.equal(calls, 1);
});

test("concurrent naming requests cannot replace the first saved identity", async () => {
  const store = new MemoryRunStore(); const run = await pending(store);
  const results = await Promise.all([store.setConversationIdentity(run.id, owner, prompt, identity), store.setConversationIdentity(run.id, owner, prompt, { title: "A Different Title", category: "food" })]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("identity sanitization preserves acronyms and rejects invalid output", () => {
  assert.deepEqual(sanitizeConversationIdentity({ title: '"NYC Flights!"', category: "travel" }), identity);
  for (const value of [{ title: "Untitled", category: "social" }, { title: "A".repeat(51), category: "travel" }, { title: "NYC Flights", category: "made-up" }, null]) assert.equal(sanitizeConversationIdentity(value), null);
});

test("a naming response only patches identity, never newer UI execution state", async () => {
  const store = new MemoryRunStore(); const run = await pending(store);
  await store.setConversationIdentity(run.id, owner, prompt, identity);
  const snapshot = (await store.getSnapshot(run.id))!;
  const item = { title: prompt, category: "social" as Category, status: "done", outcome: "Newer result", retryDecision: { title: prompt, category: "social" } as Decision };
  const updated = withConversationIdentity(item, snapshot);
  assert.equal(updated.status, "done"); assert.equal(updated.outcome, "Newer result");
  assert.equal(updated.title, identity.title); assert.equal(updated.category, identity.category);
  assert.equal(updated.retryDecision.category, identity.category);
});

test("reopening a saved workspace recovers generated titles and colours from durable runs", () => {
  const state = { decisions: [], tasks: [], history: [{ id: "entry", runId: "run", title: prompt, category: "social", outcome: "Keep this result" }], discardedDecisionIds: [] } as unknown as import("../lib/types").WorkspaceStateData;
  const restored = reconcileConversationIdentities(state, [{ id: "run", decisionId: null, ...identity }]);
  assert.equal(restored.history[0].title, "NYC Flights");
  assert.equal(restored.history[0].category, "travel");
  assert.equal(restored.history[0].outcome, "Keep this result");
});

import { applyConversationAction, conversationActionSchema } from '../lib/conversation-settings';

test('identity edits and reset preserve read, pin and archive settings', () => {
  const before = { chat: { title: 'Old name', markedUnread: true, archived: true, pinnedAt: '2026-01-01' } };
  const changed = applyConversationAction(before, { key: 'chat', action: 'identity', title: 'Trip', avatar: { type: 'character', index: 3 } });
  assert.equal(changed.chat.title, 'Trip');
  assert.deepEqual(changed.chat.avatar, { type: 'character', index: 3 });
  assert.equal(changed.chat.archived, true);
  assert.deepEqual(applyConversationAction(changed, { key: 'chat', action: 'resetIdentity' }).chat, { markedUnread: true, archived: true, pinnedAt: '2026-01-01' });
  assert.equal(before.chat.title, 'Old name');
});

test('identity validation rejects untrusted avatar URLs, invalid character indexes and text', () => {
  const action = { key: 'chat', action: 'identity', title: 'Trip' };
  for (const avatar of [{ type: 'photo', value: 'https://example.com/tracker.png' }, { type: 'photo', value: 'data:image/svg+xml;base64,PHN2Zz4=' }, { type: 'character', index: 6 }, { type: 'emoji', value: 'hello' }]) assert.equal(conversationActionSchema.safeParse({ ...action, avatar }).success, false);
  assert.equal(conversationActionSchema.safeParse({ ...action, avatar: { type: 'emoji', value: '🌴' } }).success, true);
});
