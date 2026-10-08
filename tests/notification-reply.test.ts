import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { pendingSteering } from "../lib/harness/steering";
import { threadItems } from "../lib/harness/thread";

test("notification retries append once, preserve history, and never grant approval", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "reply@example.com", decisionId: null, category: "social", title: "Dinner", request: "Find dinner", metadata: { appleConnections: { calendar: true } } });
  await store.appendMessages(run.id, [{ role: "user", content: "Find dinner" }, { role: "assistant", content: "Shall I book for two?" }]);
  const action = await store.createAction({ runId: run.id, stepId: null, scopeId: null, toolName: "browser_click", risk: "write_external", preview: "Confirm booking", input: {} });
  await store.updateRun(run.id, { status: "awaiting_approval" });
  const input = { owner: run.userId, runId: run.id, eventId: crypto.randomUUID(), text: "Make it three people." };
  const results = await Promise.all(Array.from({ length: 6 }, () => store.acceptNotificationReply(input)));
  assert.equal(results.filter(result => result?.mode === "started").length, 1);
  assert.equal(results.filter(result => result?.mode === "duplicate").length, 5);
  const snapshot = (await store.getSnapshot(run.id))!;
  assert.equal(snapshot.status, "running");
  assert.deepEqual(snapshot.metadata.appleConnections, { calendar: true });
  assert.equal(snapshot.actions.find(item => item.id === action.id)?.status, "rejected");
  assert.deepEqual(threadItems(snapshot, await store.listMessages(run.id)).filter(item => item.kind === "user" || item.kind === "agent").map(item => item.text), ["Find dinner", "Shall I book for two?", input.text]);
  await store.updateRun(run.id, { status: "done" });
  assert.equal((await store.acceptNotificationReply(input))?.mode, "duplicate");
  assert.equal((await store.getRun(run.id))?.status, "done");
});

test("active conversation replies use steering and remain deduplicated after consumption", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "steering@example.com", decisionId: null, category: "social", title: "Dinner", request: "Dinner", metadata: {} });
  const input = { owner: run.userId, runId: run.id, eventId: crypto.randomUUID(), text: "Vegetarian, please." };
  assert.equal((await store.acceptNotificationReply(input))?.mode, "steering");
  assert.equal((await store.acceptNotificationReply(input))?.mode, "duplicate");
  assert.equal(pendingSteering(await store.getRun(run.id)).length, 1);
  await store.consumeSteering(run.id);
  assert.equal((await store.acceptNotificationReply(input))?.mode, "duplicate");
  assert.equal((await store.listMessages(run.id)).length, 1);
  assert.equal(await store.acceptNotificationReply({ ...input, owner: "other@example.com" }), null);
});

test("concurrent first replies create one owned suggestion conversation", async () => {
  const store = new MemoryRunStore();
  const input = { owner: "suggestion@example.com", decisionId: crypto.randomUUID(), eventId: crypto.randomUUID(), text: "Tomorrow instead", newRun: { title: "Dinner", category: "social", request: "Tomorrow instead", metadata: { userMessage: "Tomorrow instead", originalContext: "Dinner suggestion" } } };
  const results = await Promise.all(Array.from({ length: 5 }, () => store.acceptNotificationReply(input)));
  assert.equal(new Set(results.map(result => result?.run.id)).size, 1);
  assert.equal(results.filter(result => result?.mode === "started").length, 1);
  assert.equal(results.filter(result => result?.mode === "duplicate").length, 4);
  assert.equal(results[0]?.run.request, input.text);
  assert.equal(await store.acceptNotificationReply({ owner: "other@example.com", decisionId: input.decisionId, eventId: input.eventId, text: input.text }), null);
});

test("replies preserve previous result context and replace automatic waits", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "wait@example.com", decisionId: null, category: "social", title: "Dinner", request: "Dinner", metadata: { automaticPause: { ready: true }, pauseDispatchId: "old", modelRetryAt: 10 } });
  await store.appendMessages(run.id, [{ role: "user", content: "Dinner" }]);
  await store.updateRun(run.id, { status: "paused" });
  await store.acceptNotificationReply({ owner: run.userId, runId: run.id, eventId: crypto.randomUUID(), text: "Stop waiting" });
  const saved = (await store.getRun(run.id))!;
  assert.equal(saved.status, "running");
  assert.equal(saved.metadata.automaticPause, undefined);
  assert.equal(saved.metadata.pauseDispatchId, undefined);
  assert.equal(saved.metadata.modelRetryAt, null);
});
