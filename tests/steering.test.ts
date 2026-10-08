import assert from "node:assert/strict";
import test from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { MemoryRunStore } from "../lib/harness/store";
import { appendConversationReply } from "../lib/harness/conversation-reply";
import { pendingSteering, steerableTools } from "../lib/harness/steering";
import { runAgent } from "../lib/harness/run";
import { threadItems } from "../lib/harness/thread";

async function setup(store = new MemoryRunStore()) {
  const run = await store.createRun({ userId: "steer@test.invalid", decisionId: null, request: "Find dinner", title: "Dinner", category: "food", metadata: {} });
  await store.appendMessages(run.id, [{ role: "user", content: "Find dinner" }]);
  await store.updateRun(run.id, { status: "running" });
  return { store, run };
}

test("startup checks for history without downloading the transcript", async () => {
  class ExistenceOnlyStore extends MemoryRunStore {
    override async listMessages(): Promise<never> { throw new Error("Unnecessary transcript read"); }
  }
  const store = new ExistenceOnlyStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "test", request: "Hello", title: "Hello", metadata: {} });
  assert.equal(await store.hasMessages(run.id), false);
  // Base implementation is used only to seed this test's transcript.
  await MemoryRunStore.prototype.appendMessages.call(new MemoryRunStore(), run.id, [{ role: "user", content: "Hello" }]);
  assert.equal(await store.hasMessages(run.id), true);
  assert.equal(await store.hasMessages("other-chat"), false);
});

test("steering survives reload, displays delivered, and is consumed once after tool results", async () => {
  const { store, run } = await setup();
  assert.equal(await appendConversationReply(store, run.id, "Make it vegan"), "steering");
  assert.equal(await appendConversationReply(store, run.id, "Under $40"), "steering");
  const snapshot = (await store.getSnapshot(run.id))!;
  const pending = pendingSteering(snapshot);
  assert.equal((await store.listMessages(run.id)).length, 1);
  const visible = threadItems(snapshot, await store.listMessages(run.id));
  assert.deepEqual(visible.slice(-2).map(i => i.kind === "user" && [i.text, !!i.deliveredAt, i.readAt]), [["Make it vegan", true, undefined], ["Under $40", true, undefined]]);
  await store.appendMessages(run.id, [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "search", toolName: "search", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "search", toolName: "search", output: { type: "text", value: "Restaurants" } }] },
  ]);
  assert.equal(await new MemoryRunStore().consumeSteering(run.id), true);
  assert.equal(await store.consumeSteering(run.id), false);
  const messages = await store.listMessages(run.id);
  assert.deepEqual(messages.map(m => m.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(messages.slice(-2).map(m => m.id), pending.map(m => m.id));
  assert.deepEqual(messages.map(m => m.message.role), ["user", "assistant", "tool", "user", "user"]);
});

test("input during a running tool redirects the next model call in the same worker", async () => {
  const { store, run } = await setup();
  let calls = 0, disposed = 0;
  await runAgent({ runId: run.id, store, model: { dispose: async () => { disposed++; }, turn: async ({ onNarration }) => {
    calls++;
    if (calls === 1) {
      await onNarration("Checking dinner.");
      await appendConversationReply(store, run.id, "Actually lunch");
      await store.appendMessages(run.id, [{ role: "assistant", content: "Dinner search returned." }]);
      return;
    }
    assert.equal((await store.listMessages(run.id)).at(-1)?.message.content, "Actually lunch");
    await onNarration("Found lunch.");
  } } });
  assert.equal(calls, 2); assert.equal(disposed, 1);
  assert.equal((await store.getRun(run.id))?.result?.summary, "Found lunch.");
});

test("the finalization race cannot strand a delivered message", async () => {
  class RacingStore extends MemoryRunStore {
    inject = true;
    override async finishRunIfNoSteering(...args: Parameters<MemoryRunStore["finishRunIfNoSteering"]>) {
      if (this.inject) { this.inject = false; await appendConversationReply(this, args[0], "One more constraint"); }
      return super.finishRunIfNoSteering(...args);
    }
  }
  const { store, run } = await setup(new RacingStore());
  let calls = 0;
  await runAgent({ runId: run.id, store, model: { turn: async ({ onNarration }) => { await onNarration(++calls === 1 ? "Old result" : "New result"); } } });
  assert.equal(calls, 2);
  assert.equal((await store.getRun(run.id))?.result?.summary, "New result");
  assert.equal(pendingSteering(await store.getRun(run.id)).length, 0);
});

test("a queued correction supersedes a pause created by an in-flight tool", async () => {
  const { store, run } = await setup(); let calls = 0;
  await runAgent({ runId: run.id, store, model: { turn: async ({ onNarration }) => {
    if (++calls === 1) {
      await appendConversationReply(store, run.id, "Don't send it");
      await store.createAction({ runId: run.id, stepId: null, toolName: "gmail_send_draft", risk: "write_external", preview: "Send", input: {} });
      await store.updateRun(run.id, { status: "awaiting_approval" });
      return;
    }
    assert.equal((await store.getSnapshot(run.id))?.actions[0].status, "rejected");
    await onNarration("Kept the draft.");
  } } });
  assert.equal(calls, 2); assert.equal((await store.getRun(run.id))?.status, "done");
});

test("steering guards external and pause tools until new input is consumed", async () => {
  const { store, run } = await setup(); let executed = 0;
  const tools = steerableTools({ send: tool({ inputSchema: z.object({}), execute: async () => { executed++; return "sent"; } }) }, store, run.id);
  await appendConversationReply(store, run.id, "Don't send");
  await assert.rejects(async () => tools.send.execute!({}, { toolCallId: "1", messages: [], context: {} }), /New user input/);
  assert.equal(executed, 0);
  await store.consumeSteering(run.id);
  await tools.send.execute!({}, { toolCallId: "2", messages: [], context: {} });
  assert.equal(executed, 1);
});

test("cancellation stays stopped even with pending steering", async () => {
  const { store, run } = await setup();
  await appendConversationReply(store, run.id, "Make it vegan");
  await store.updateRun(run.id, { status: "cancelled" });
  assert.equal(await store.consumeSteering(run.id), false);
  let calls = 0;
  await runAgent({ runId: run.id, store, model: { turn: async () => { calls++; } } });
  assert.equal(calls, 0);
  assert.equal((await store.getRun(run.id))?.status, "cancelled");
});

test("a correction arriving during action setup prevents the external side effect", async () => {
  const { executeGuardedAction } = await import("../lib/harness/actions");
  class SetupRaceStore extends MemoryRunStore {
    override async approveAction(...args: Parameters<MemoryRunStore["approveAction"]>) {
      const approved = await super.approveAction(...args);
      await appendConversationReply(this, args[1], "Don't send it");
      return approved;
    }
  }
  const { store, run } = await setup(new SetupRaceStore()); let sent = false;
  await assert.rejects(() => executeGuardedAction({ runId: run.id, toolName: "gmail_send_draft", risk: "write_external", preview: "Send", args: {}, store, alwaysApproved: true, execute: async () => { sent = true; return {}; } }), /New user input/);
  assert.equal(sent, false);
  await store.consumeSteering(run.id);
  assert.equal((await store.getSnapshot(run.id))?.actions[0].status, "rejected");
});

test("failed attachment storage leaves an active run intact", async () => {
  class UploadFailureStore extends MemoryRunStore { override async createArtifact(): Promise<never> { throw new Error("Upload unavailable"); } }
  const { store, run } = await setup(new UploadFailureStore());
  await assert.rejects(() => appendConversationReply(store, run.id, "Read this", [{ name: "note.txt", mimeType: "text/plain", dataBase64: "YQ==" }]), /Upload unavailable/);
  assert.equal((await store.getRun(run.id))?.status, "running");
});
