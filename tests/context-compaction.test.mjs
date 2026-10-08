import test from "node:test";
import assert from "node:assert/strict";
import { storedOpenAIModel } from "../lib/harness/stored-openai.ts";
import { stepCountIs, streamText, tool, wrapLanguageModel } from "ai";
import { z } from "zod";
import { compactModelMessages, OPENAI_COMPACT_THRESHOLD, replayModelMessages } from "../lib/harness/context-compaction.ts";
import { createCommentaryPersistence } from "../lib/harness/commentary-persistence.ts";
import { cacheableInstructions, modelProviderOptions } from "../lib/harness/model.ts";
import { MemoryRunStore } from "../lib/harness/store.ts";
import { threadItems } from "../lib/harness/thread.ts";

const selected = { provider: "openai", modelId: "gpt-5.6-terra", reasoningEffort: "medium" };
test("Sol 6.1 compacts at 850K while fallback models retain their prior threshold", () => {
  assert.deepEqual(modelProviderOptions({ ...selected, modelId: "gpt-6.1-sol" }, "turn", "test").openai.contextManagement,
    [{ type: "compaction", compactThreshold: 850_000 }]);
  assert.deepEqual(modelProviderOptions(selected, "turn", "test").openai.contextManagement,
    [{ type: "compaction", compactThreshold: 200_000 }]);
});
const checkpoint = id => ({ type: "custom", kind: "openai.compaction", providerOptions: { openai: { type: "compaction", itemId: id, encryptedContent: `encrypted-${id}` } } });
const text = value => ({ type: "text", text: value });
const assistant = (...content) => ({ role: "assistant", content });
const messageItem = (id, value, phase) => ({ type: "message", id, phase, text: value });
const compactionItem = id => ({ type: "compaction", id, encrypted_content: `encrypted-${id}` });

// Exercise the installed OpenAI adapter, including SSE parsing, custom-part
// conversion, JSON storage/reload, and the actual next-request wire format.
function responseStream(items, id) {
  const events = [{ type: "response.created", response: { id, model: selected.modelId, created_at: 1 } }];
  items.forEach((item, output_index) => {
    events.push({ type: "response.output_item.added", output_index, item });
    if (item.type === "message") events.push({ type: "response.output_text.delta", item_id: item.id, output_index, content_index: 0, delta: item.text });
    events.push({ type: "response.output_item.done", output_index, item });
  });
  events.push({ type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 5 } } });
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

for (const pause of [false, true]) test(`native compaction survives tools and saved-history replay (${pause ? "approval pause" : "multi-step turn"})`, async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "compaction-test", decisionId: null, category: "money", title: "Check charge", request: "Check that charge", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  await store.appendMessages(run.id, [
    { role: "user", content: "Earlier conversation that must remain visible" },
    assistant({ type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_old_unstored", reasoningEncryptedContent: "old-encrypted-reasoning" } } }, text("Earlier answer")),
    { role: "user", content: run.request },
  ]);
  const requests = [];
  const outputs = [
    [messageItem("msg_before", "ill check the charge", "commentary"), compactionItem("cmp_1"), messageItem("msg_after", "checking its status now", "commentary"), { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "{}", status: "completed" }],
    [messageItem("msg_final", "it was refunded", "final_answer")],
    [compactionItem("cmp_2"), messageItem("msg_followup", "the refund is still confirmed", "final_answer")],
  ];
  const model = storedOpenAIModel(selected.modelId, { apiKey: "test-key", fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const output = outputs.shift();
    assert.ok(output, "No unexpected model calls");
    return responseStream(output, `resp_${requests.length}`);
  } });
  let toolCalls = 0;
  const tools = { lookup: tool({ inputSchema: z.object({}), execute: async () => {
    toolCalls++;
    const visible = threadItems(await store.getSnapshot(run.id), await store.listMessages(run.id));
    assert.deepEqual(visible.filter(item => item.kind === "agent").map(item => item.text), ["Earlier answer", "ill check the charge"]);
    if (pause) await store.updateRun(run.id, { status: "paused" });
    return { refunded: true };
  } }) };
  async function turn() {
    const persistence = createCommentaryPersistence(store, run.id, () => true);
    const result = streamText({
      model: wrapLanguageModel({ model, middleware: persistence.middleware }),
      instructions: cacheableInstructions(selected, "Keep the current authorization boundary.", "Current runtime context for this turn."),
      messages: replayModelMessages(JSON.parse(JSON.stringify(await store.listMessages(run.id)))),
      providerOptions: modelProviderOptions(selected, "turn", run.userId),
      prepareStep: ({ messages }) => ({ messages: compactModelMessages(messages, selected.provider) }),
      tools,
      stopWhen: [stepCountIs(4), async () => (await store.getRun(run.id)).status === "paused"],
      onStepEnd: async step => { await store.appendMessages(run.id, persistence.remainingMessages(step.response.messages)); },
      onError: ({ error }) => { throw error; },
    });
    await result.consumeStream();
    await result.steps;
  }
  await turn();
  assert.equal(toolCalls, 1);
  assert.equal(requests[0].store, true);
  assert.ok(!requests[0].input.some(item => item.type === "item_reference"));
  assert.equal(requests[0].input.find(item => item.type === "reasoning").encrypted_content, "old-encrypted-reasoning");
  if (pause) {
    assert.equal(requests.length, 1);
    await store.updateRun(run.id, { status: "running" });
    await store.appendMessages(run.id, [{ role: "user", content: "Continue; I signed in." }]);
    await turn();
  }
  assert.equal(requests.length, 2);
  assert.equal(toolCalls, 1, "Resuming does not repeat the executed tool");
  const next = requests[1];
  assert.deepEqual(next.context_management, [{ type: "compaction", compact_threshold: OPENAI_COMPACT_THRESHOLD }]);
  assert.equal(next.store, true);
  assert.ok(next.include.includes("reasoning.encrypted_content"));
  assert.deepEqual(next.input.find(item => item.type === "compaction"), compactionItem("cmp_1"));
  assert.ok(!next.input.some(item => item.type === "item_reference"));
  assert.ok(!JSON.stringify(next.input).includes("Earlier answer"));
  assert.ok(!JSON.stringify(next.input).includes("ill check the charge"));
  assert.equal(JSON.stringify(next.input).includes("checking its status now"), !pause);
  assert.ok(JSON.stringify(next.input).includes("Keep the current authorization boundary."));
  assert.equal(next.input.at(-1).content, "Current runtime context for this turn.");
  if (!pause) assert.equal(next.input.find(item => item.id === "msg_after").phase, "commentary");
  assert.equal(next.input.filter(item => item.type === "function_call").length, 1);
  assert.equal(next.input.filter(item => item.type === "function_call_output").length, 1);
  if (pause) assert.ok(JSON.stringify(next.input).includes("Continue; I signed in."));

  await store.appendMessages(run.id, [{ role: "user", content: "Is that still confirmed?" }]);
  await turn();
  assert.equal(requests[2].input.find(item => item.id === "msg_final").phase, "final_answer");
  const rows = JSON.parse(JSON.stringify(await store.listMessages(run.id)));
  const replay = replayModelMessages(rows);
  const compacted = compactModelMessages(replay, "openai");
  assert.deepEqual(compacted, [assistant(checkpoint("cmp_2"), {
    type: "text", text: "the refund is still confirmed", providerOptions: { openai: { itemId: "msg_followup", phase: "final_answer" } },
  })]);
  const visible = threadItems(await store.getSnapshot(run.id), rows);
  assert.deepEqual(visible.filter(item => item.kind === "agent").map(item => item.text), ["Earlier answer", "ill check the charge", "it was refunded", "the refund is still confirmed"]);
  assert.ok(!JSON.stringify(visible).includes("encrypted-"));
  const anthropic = compactModelMessages(replay, "anthropic");
  assert.ok(JSON.stringify(anthropic).includes("Earlier answer"));
  assert.equal(JSON.stringify(anthropic).split("checking its status now").length - 1, 0);
  assert.ok(!JSON.stringify(anthropic).includes("openai.compaction"));
});

test("short histories are intact and incomplete checkpoints never authorize pruning", () => {
  const history = [{ role: "user", content: "Remember this" }, assistant(text("I will"))];
  assert.equal(compactModelMessages(history, "openai"), history);
  for (const providerOptions of [{}, { openai: { itemId: "cmp_bad" } }, { openai: { itemId: "cmp_bad", encryptedContent: "" } }]) {
    const input = [...history, assistant({ type: "custom", kind: "openai.compaction", providerOptions })];
    assert.equal(compactModelMessages(input, "openai"), input);
  }
});

test("compaction between a tool call and its result keeps the call paired", () => {
  const input = [
    { role: "user", content: "Look it up" },
    assistant({ type: "tool-call", toolCallId: "lookup", toolName: "lookup", input: {} }, checkpoint("cmp_1")),
    { role: "tool", content: [{ type: "tool-result", toolCallId: "lookup", toolName: "lookup", output: { type: "json", value: { found: true } } }] },
  ];
  assert.equal(compactModelMessages(input, "openai"), input);
  const next = [...input, assistant(checkpoint("cmp_2")), { role: "user", content: "Continue" }];
  assert.deepEqual(compactModelMessages(next, "openai"), next.slice(-2));
});

test("system instructions survive input pruning and other providers do not receive compaction settings", () => {
  const system = { role: "system", content: "Current policy" };
  const input = [system, { role: "user", content: "Old" }, assistant(text("Old"), checkpoint("cmp_1"), text("New"))];
  assert.deepEqual(compactModelMessages(input, "openai"), [system, assistant(checkpoint("cmp_1"), text("New"))]);
  const options = modelProviderOptions({ provider: "anthropic", modelId: "claude-sonnet-5", reasoningEffort: "medium" }, "turn", "user");
  assert.equal(options.openai, undefined);
  assert.equal(options.anthropic.contextManagement, undefined);
});


test("legacy early commentary replays inline without a dependent provider ID", () => {
  const commentary = { type: "text", text: "Checking now", providerOptions: { openai: { phase: "commentary", itemId: "msg_early" } } };
  const reasoning = { type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_required", reasoningEncryptedContent: "encrypted" } } };
  const rows = [{ id: "early", message: assistant(commentary) }, { id: "step", message: assistant(reasoning) }];
  const replay = replayModelMessages(rows);
  assert.equal(replay[0].content[0].providerOptions.openai.itemId, undefined);
  assert.equal(replay[0].content[0].providerOptions.openai.phase, "commentary");
  assert.equal(replay[1].content[0], reasoning);
  assert.equal(rows[0].message.content[0].providerOptions.openai.itemId, "msg_early");
});
