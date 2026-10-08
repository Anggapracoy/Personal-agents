import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { isReactionEmoji, reactionMessage, reactionOf } from "../lib/harness/reactions";
import { threadItems } from "../lib/harness/thread";
import { pendingSteering } from "../lib/harness/steering";
import { conversationResponseTools, withoutAssistantText } from "../lib/harness/conversation-response";
import { appendConversationReply } from "../lib/harness/conversation-reply";
import { runAgent } from "../lib/harness/run";
import { historyFromRun } from "../app/workspace-model";
import { conversationItems } from "../app/conversations";

async function setup() {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "reaction@test.invalid", decisionId: null, category: "social", title: "Dinner", request: "Find dinner", metadata: {} });
  const messages = await store.appendMessages(run.id, [{ role: "user", content: "Find dinner" }, { role: "assistant", content: "want me to find a few places?" }]);
  await store.updateRun(run.id, { status: "done" });
  return { store, run, messages };
}
const options = { toolCallId: "test", messages: [], context: {} };
test("emoji validation accepts one joined grapheme and rejects text or multiple emoji", () => {
  for (const value of ["👍", "👍🏽", "❤️", "‼️", "❓", "👨‍👩‍👧‍👦", "🇨🇦", "1️⃣"]) assert.equal(isReactionEmoji(value), true, value);
  for (const value of ["", "ok", "hi👍", "👍👍", " ", "a", "1"]) assert.equal(isReactionEmoji(value), false, value);
});
test("user reaction is durable input, deduplicated across retries and rendered only on its target", async () => {
  const { store, run, messages } = await setup();
  const event = reactionMessage({ eventId: crypto.randomUUID(), messageId: messages[1].id, emoji: "👍" }, "user", "want me to find a few places?");
  assert.equal(await store.acceptReaction(run.id, event), "started");
  assert.equal(await store.acceptReaction(run.id, event), "duplicate");
  const history = await new MemoryRunStore().listMessages(run.id);
  assert.equal(history.length, 3);
  assert.match(String(history[2].message.content), /want me to find a few places/);
  const items = threadItems((await store.getSnapshot(run.id))!, history);
  assert.equal(items.length, 2);
  assert.equal(items[1].kind === "agent" && items[1].reactions?.[0].emoji, "👍");
  assert.equal((await store.getRun(run.id))?.status, "running");
});
test("reaction during work queues once and cannot be lost to finalization", async () => {
  const { store, run, messages } = await setup();
  await store.updateRun(run.id, { status: "running" });
  const event = reactionMessage({ eventId: crypto.randomUUID(), messageId: messages[1].id, emoji: "❤️" }, "user", "offer");
  const results = await Promise.all(Array.from({ length: 8 }, () => store.acceptReaction(run.id, event)));
  assert.equal(results.filter(result => result === "steering").length, 1);
  assert.equal(pendingSteering(await store.getRun(run.id)).length, 1);
  assert.equal(await store.finishRunIfNoSteering(run.id, null), false);
  const queued = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.equal(queued.length, 2);
  assert.equal(queued[1].kind === "agent" && queued[1].reactions?.[0].emoji, "❤️");
  await store.consumeSteering(run.id);
  assert.equal(reactionOf((await store.listMessages(run.id)).at(-1)!.message)?.emoji, "❤️");
});
test("replacement and removal retain the other participant's reaction", async () => {
  const { store, run, messages } = await setup();
  for (const [actor, emoji] of [["agent", "😊"], ["user", "👍"], ["user", "❤️"], ["user", null]] as const) {
    await store.appendMessages(run.id, [reactionMessage({ eventId: crypto.randomUUID(), messageId: messages[1].id, emoji }, actor, "offer")]);
  }
  const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.equal(items.length, 2);
  assert.deepEqual(items[1].kind === "agent" && items[1].reactions?.map(r => [r.actor, r.emoji]), [["agent", "😊"]]);
});
test("silent completion preserves read receipt with no generated result, bubble, or unread marker", async () => {
  const { store, run, messages } = await setup();
  await store.updateRun(run.id, { status: "running" });
  await store.updateRunMetadata(run.id, { messageReceipt: { messageId: messages[0].id, readAt: "2026-09-07T12:00:00Z" } });
  await runAgent({ store, runId: run.id, model: { turn: async () => {
    const tools = conversationResponseTools(store, run.id, () => undefined);
    await tools.finish_without_reply.execute!({}, options);
  } } });
  const snapshot = (await store.getSnapshot(run.id))!;
  assert.equal(snapshot.status, "done"); assert.equal(snapshot.response, ""); assert.equal(snapshot.result, null);
  const items = threadItems(snapshot, await store.listMessages(run.id));
  assert.equal(items.length, 2);
  assert.equal(items[0].kind === "user" && items[0].readAt, "2026-09-07T12:00:00Z");
  const entry = historyFromRun(snapshot);
  assert.equal(entry.outcome, ""); assert.equal(entry.subtitle, "");
  assert.equal(conversationItems([], [], [entry])[0].unread, false);
});
test("agent can react without a text reply and cannot target another thread or an agent message", async () => {
  const { store, run, messages } = await setup();
  let ended = false;
  const tools = conversationResponseTools(store, run.id, () => { ended = true; });
  assert.equal((await tools.react_to_message.execute!({ messageId: "foreign-id", emoji: "👍" }, options) as { accepted: boolean }).accepted, false);
  assert.equal((await tools.react_to_message.execute!({ messageId: messages[1].id, emoji: "👍" }, options) as { accepted: boolean }).accepted, false);
  assert.equal(ended, false);
  await tools.react_to_message.execute!({ messageId: messages[0].id, emoji: "👍" }, options);
  assert.equal(ended, true);
  const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.equal(items.length, 2);
  assert.equal(items[0].kind === "user" && items[0].reactions?.[0].actor, "agent");
  assert.equal((await store.getRun(run.id))?.response, "");
});
test("quiet responses remove stray prose while retaining tool-call audit", () => {
  const result = withoutAssistantText([{ role: "assistant", content: "ok" }, { role: "assistant", content: [{ type: "text", text: "Done" }, { type: "tool-call", toolName: "finish_without_reply", toolCallId: "silent", input: {} }] }, { role: "tool", content: [{ type: "tool-result", toolCallId: "silent", toolName: "finish_without_reply", output: { type: "json", value: { accepted: true } } }] }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].role, "assistant");
  assert.equal(Array.isArray(result[0].content) && result[0].content.length, 1);
});
test("quoted reply delivers exact context without exposing runtime text in the bubble", async () => {
  const { store, run, messages } = await setup();
  await appendConversationReply(store, run.id, "yes, that one", [], { messageId: messages[1].id, text: "want me to find a few places?", role: "agent" });
  const history = await store.listMessages(run.id);
  assert.match(JSON.stringify(history.at(-1)?.message.content), /reply context/);
  const items = threadItems((await store.getSnapshot(run.id))!, history);
  const last = items.at(-1)!;
  assert.equal(last.kind === "user" && last.text, "yes, that one");
  assert.equal(last.kind === "user" && last.replyTo?.messageId, messages[1].id);
});
test("retrying the same visible reaction with a new request ID never starts the offered work twice", async () => {
  const { store, run, messages } = await setup();
  const send = () => store.acceptReaction(run.id, reactionMessage({ eventId: crypto.randomUUID(), messageId: messages[1].id, emoji: "👍" }, "user", "offer"));
  assert.equal(await send(), "started");
  await store.updateRun(run.id, { status: "done" });
  assert.equal(await send(), "duplicate");
  assert.equal((await store.getRun(run.id))?.status, "done");
});
test("a social reaction cannot dismiss an unrelated pending approval", async () => {
  const { store, run, messages } = await setup();
  const action = await store.createAction({ runId: run.id, stepId: null, toolName: "gmail_send_draft", risk: "write_external", preview: "Send email", input: {} });
  await store.updateRun(run.id, { status: "awaiting_approval" });
  await store.acceptReaction(run.id, reactionMessage({ eventId: crypto.randomUUID(), messageId: messages[1].id, emoji: "❤️" }, "user", "offer"));
  await runAgent({ store, runId: run.id, model: { turn: async () => { await conversationResponseTools(store, run.id, () => undefined).finish_without_reply.execute!({}, options); } } });
  assert.equal((await store.getRun(run.id))?.status, "awaiting_approval");
  assert.equal((await store.getAction(action.id, run.id))?.status, "proposed");
});
test("a short text response to a reaction also retains unrelated approval controls", async () => {
  const { store, run, messages } = await setup();
  await store.createAction({ runId: run.id, stepId: null, toolName: "gmail_send_draft", risk: "write_external", preview: "Send email", input: {} });
  await store.updateRun(run.id, { status: "awaiting_approval" });
  await store.acceptReaction(run.id, reactionMessage({ eventId: crypto.randomUUID(), messageId: messages[1].id, emoji: "❤️" }, "user", "offer"));
  await runAgent({ store, runId: run.id, model: { turn: async ({ onNarration }) => { await onNarration("😊"); } } });
  assert.equal((await store.getRun(run.id))?.status, "awaiting_approval");
});
test("an opening reaction has no invented user bubble and can be removed before model startup", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "reaction@test.invalid", decisionId: "offer", category: "food", title: "Dinner", request: "Reacted 👍", metadata: { sourceType: "email", retryDecision: { subtitle: "want me to find dinner?" }, initialReaction: "👍" } });
  let items = threadItems((await store.getSnapshot(run.id))!, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind === "agent" && items[0].reactions?.[0].emoji, "👍");
  const event = reactionMessage({ eventId: crypto.randomUUID(), messageId: `${run.id}:opening`, emoji: null }, "user", "want me to find dinner?");
  assert.equal(await store.acceptReaction(run.id, event), "steering");
  items = threadItems((await store.getSnapshot(run.id))!, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind === "agent" && items[0].reactions?.length, 0);
});
test("reaction service validates the target and can retry a failed dispatch without duplicating input", async () => {
  const { appendConversationReaction } = await import("../lib/harness/conversation-reply");
  const { store, run, messages } = await setup();
  const other = await setup();
  const input = { eventId: crypto.randomUUID(), messageId: messages[1].id, emoji: "👍" };
  assert.equal(await appendConversationReaction(store, run.id, { ...input, messageId: other.messages[1].id }), null);
  assert.equal(await appendConversationReaction(store, run.id, input), "started");
  await store.updateRun(run.id, { status: "failed", error: "Dispatch unavailable" });
  assert.equal(await appendConversationReaction(store, run.id, input), "started");
  assert.equal((await store.listMessages(run.id)).length, 3);
  assert.equal((await store.getRun(run.id))?.error, null);
});


test("users can react to their own persisted messages, including replacement and removal", async () => {
  const { appendConversationReaction } = await import("../lib/harness/conversation-reply");
  const { store, run, messages } = await setup();
  for (const emoji of ["👍", "❤️", null]) {
    await appendConversationReaction(store, run.id, { eventId: crypto.randomUUID(), messageId: messages[0].id, emoji });
    const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
    const target = items.find(item => item.id === messages[0].id);
    assert.equal(target?.kind === "user" && (target.reactions?.[0]?.emoji ?? null), emoji);
  }
});

test("no-action choices persist a thumbs-up on the choice without an assistant text receipt", async () => {
  const { historyFromDecision } = await import("../app/workspace-model");
  const { historyThreadItems } = await import("../app/history-thread");
  const entry = historyFromDecision({ id: "offer", category: "money", urgency: "low", title: "Renewal?", subtitle: "Keep your subscription?", originalContext: "Renewal", sourceType: "proactive", options: [], dismissLabel: "Not now", createdAt: new Date().toISOString() }, "Leave it", "dismissed");
  const restored = JSON.parse(JSON.stringify(entry));
  const items = historyThreadItems(restored);
  assert.equal(items.length, 2);
  assert.equal(items[1].kind === "user" && items[1].reactions?.[0].emoji, "👍");
  assert.equal(entry.outcome, "");
  assert.equal(entry.responseDisposition, "reaction");
  const rows = conversationItems([], [], [restored]);
  assert.equal(rows[0].line, "Reacted 👍");
  assert.equal(rows[0].unread, false);
});

test("starting a later turn preserves the no-action acknowledgment and user tapbacks", async () => {
  const { clientRunMetadataSchema } = await import('../lib/harness/client-metadata');
  const metadata = clientRunMetadataSchema.parse({previousConversation:[
    {role:'assistant',text:'Keep your subscription?',reactions:[{actor:'user',emoji:'❤️',createdAt:''}]},
    {role:'user',text:'Leave it',reactions:[{actor:'agent',emoji:'👍',createdAt:''}]},
  ]});
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'test@example.com',decisionId:'offer',category:'money',title:'Renewal',request:'Actually cancel it',metadata});
  const items = threadItems((await store.getSnapshot(run.id))!, []);
  assert.equal(items[0].kind === 'agent' && items[0].reactions?.[0].emoji, '❤️');
  assert.equal(items[1].kind === 'user' && items[1].reactions?.[0].emoji, '👍');
  assert.ok(!JSON.stringify(items).includes('No action taken'));
});
