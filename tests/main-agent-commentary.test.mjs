import test from "node:test";
import assert from "node:assert/strict";
import { streamText, wrapLanguageModel, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createCommentaryPersistence, openingAlreadySentForTurn } from "../lib/harness/commentary-persistence.ts";
import { MemoryRunStore } from "../lib/harness/store.ts";
import { replayModelMessages } from "../lib/harness/context-compaction.ts";
import { threadItems } from "../lib/harness/thread.ts";
import { isRuntimeMessage, taskElapsedNote } from "../lib/harness/runtime-message.ts";
import { agentCommunicationGuidance } from "../lib/conversation-copy.ts";

test("the model only hears about elapsed time once a task is long", () => {
  const start = Date.parse("2026-09-25T12:00:00Z");
  assert.deepEqual(taskElapsedNote(start, start + 5 * 60_000), []);
  const [note] = taskElapsedNote(start, start + 11 * 60_000);
  assert.equal(note.content, "[runtime] This task has been running for 11 minutes.");
  assert.equal(isRuntimeMessage(note), true, "never mistaken for a new user request");
  assert.match(agentCommunicationGuidance, /Almost every task gets no updates at all/);
  assert.match(agentCommunicationGuidance, /at most one update per 10 minutes/);
});

test("elapsed notes wait eight minutes between injections, including restored timestamps", () => {
  const start = Date.parse("2026-09-25T12:00:00Z");
  const minute = 60_000;
  assert.equal(taskElapsedNote(start, start + 8 * minute).length, 1);
  const restored = JSON.parse(JSON.stringify({ notedAt: start + 8 * minute }));
  for (const elapsed of [8, 8.5, 9, 15, 15.99]) {
    assert.deepEqual(taskElapsedNote(start, start + elapsed * minute, restored.notedAt), []);
  }
  assert.equal(taskElapsedNote(start, start + 16 * minute, restored.notedAt).length, 1);
  assert.deepEqual(taskElapsedNote(start, start + 27 * minute, start + 26 * minute), []);
  assert.equal(taskElapsedNote(start, start + 34 * minute, start + 26 * minute).length, 1);
});

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
function streamed(parts, reason = "stop") {
  return { stream: new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(part);
    controller.enqueue({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
    controller.close();
  } }) };
}
function textParts(text, phase, id) {
  const providerMetadata = { openai: { phase, itemId: id } };
  return [{ type: "text-start", id, providerMetadata }, { type: "text-delta", id, delta: text }, { type: "text-end", id, providerMetadata }];
}

for (const pause of [false, true]) test(`main loop persists its opening before tools and keeps phase/order (${pause ? "sign-in pause" : "completion"})`, async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "main-voice-test", decisionId: null, category: "money", title: "Check charge", request: "Check that charge", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  await store.appendMessages(run.id, [{ role: "user", content: run.request }]);
  const commentary = createCommentaryPersistence(store, run.id, () => true);
  const model = new MockLanguageModelV4({ doStream: [
    streamed([{ type: "reasoning-start", id: "rs_1" }, { type: "reasoning-delta", id: "rs_1", delta: "" }, { type: "reasoning-end", id: "rs_1", providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" } } }, ...textParts("ill check the charge", "commentary", "opening"), { type: "tool-call", toolCallId: "lookup", toolName: "lookup", input: "{}" }], "tool-calls"),
    streamed(textParts("it was refunded", "final_answer", "ending")),
  ] });
  const result = streamText({
    model: wrapLanguageModel({ model, middleware: commentary.middleware }),
    prompt: run.request,
    tools: { lookup: tool({ inputSchema: z.object({}), execute: async () => {
      const visible = threadItems(await store.getSnapshot(run.id), await store.listMessages(run.id));
      assert.deepEqual(visible.filter(item => item.kind === "agent").map(item => item.text), ["ill check the charge"]);
      if (pause) await store.updateRun(run.id, { status: "paused" });
      return pause ? { needsSignIn: true } : { refunded: true };
    } }) },
    stopWhen: [stepCountIs(3), async () => (await store.getRun(run.id)).status === "paused"],
    onStepEnd: async step => { await store.appendMessages(run.id, commentary.remainingMessages(step.response.messages)); },
  });
  await result.consumeStream();
  const messages = await store.listMessages(run.id);
  const visible = threadItems(await store.getSnapshot(run.id), messages).filter(item => item.kind === "agent").map(item => item.text);
  assert.deepEqual(visible, pause ? ["ill check the charge"] : ["ill check the charge", "it was refunded"]);
  assert.equal(model.doStreamCalls.length, pause ? 1 : 2);
  assert.equal(messages[1].message.content[0].providerOptions.openai.phase, "commentary");
  assert.equal(messages.filter(item => item.message.role === "tool").length, 1);
  const savedReplay = replayModelMessages(JSON.parse(JSON.stringify(messages)));
  const parts = savedReplay.flatMap(message => Array.isArray(message.content) ? message.content : []);
  assert.deepEqual(parts.filter(part => ["reasoning", "text", "tool-call"].includes(part.type)).slice(0, 3).map(part => part.type), ["reasoning", "text", "tool-call"]);
  assert.equal(parts.filter(part => part.type === "text" && part.text === "ill check the charge").length, 1);
  assert.equal(parts.find(part => part.type === "text" && part.text === "ill check the charge").providerOptions.openai.itemId, "opening");
  if (!pause) {
    assert.equal(messages.at(-1).message.content[0].providerOptions.openai.phase, "final_answer");
    const replay = model.doStreamCalls[1].prompt.flatMap(message => Array.isArray(message.content) ? message.content : []);
    assert.ok(replay.some(part => part.type === "text" && part.providerOptions?.openai?.phase === "commentary"));
  }
});

for (const provider of ['openai', 'meta']) test(`${provider} commentary between tool steps is shown (the prompt keeps it rare), and tool history and final reply survive`, async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'quiet-test',decisionId:null,category:'test',title:'Quiet tools',request:'Check checkout',metadata:{}});
  const commentary = createCommentaryPersistence(store, run.id, () => true);
  const parts = (text, id) => provider === 'openai' ? textParts(text, 'commentary', id) : [{type:'text-start',id},{type:'text-delta',id,delta:text},{type:'text-end',id}];
  const model = new MockLanguageModelV4({doStream:[
    streamed([...parts('checking', 'one'),{type:'tool-call',toolCallId:'one',toolName:'lookup',input:'{}'}],'tool-calls'),
    streamed([...parts('still checking', 'two'),{type:'tool-call',toolCallId:'two',toolName:'lookup',input:'{}'}],'tool-calls'),
    streamed([...parts('checking again', 'three'),{type:'tool-call',toolCallId:'three',toolName:'lookup',input:'{}'}],'tool-calls'),
    streamed(textParts('checkout is unavailable', 'final_answer', 'final')),
  ]});
  const result = streamText({model:wrapLanguageModel({model,middleware:commentary.middleware}),prompt:'Check checkout',tools:{lookup:tool({inputSchema:z.object({}),execute:async()=>({error:'timeout'})})},stopWhen:stepCountIs(5),onStepEnd:async step=>{await store.appendMessages(run.id,commentary.remainingMessages(step.response.messages));}});
  await result.consumeStream();
  const messages = await store.listMessages(run.id);
  // OpenAI marks commentary explicitly, so later progress updates are saved; unmarked step text still stays hidden.
  assert.deepEqual(threadItems(await store.getSnapshot(run.id),messages).filter(item=>item.kind==='agent').map(item=>item.text),
    provider === 'openai' ? ['checking','still checking','checking again','checkout is unavailable'] : ['checking','checkout is unavailable']);
  assert.equal(messages.filter(item=>item.message.role==='tool').length,3);
  const resumed = createCommentaryPersistence(store,run.id,()=>true,true);
  const filtered = resumed.remainingMessages([{role:'assistant',content:[{type:'text',text:'resuming again'},{type:'tool-call',toolCallId:'four',toolName:'lookup',input:{}}]}]);
  assert.equal(filtered[0].content.some(part=>part.type==='text'),false);
});

test('a user answer gets one acknowledgment before browser work resumes, while automatic receipts stay quiet', async () => {
  assert.equal(openingAlreadySentForTurn(true, false, true), false);
  assert.equal(openingAlreadySentForTurn(false, false, true), true);
  assert.equal(openingAlreadySentForTurn(true, true, true), true);

  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'clarification-test', decisionId: null, category: 'test', title: 'Continue order', request: 'Order a bag', metadata: {} });
  await store.appendMessages(run.id, [
    { role: 'assistant', content: 'Should I order it anyway?' },
    { role: 'user', content: 'Yes, thanks for asking' },
  ]);
  const commentary = createCommentaryPersistence(store, run.id, () => true, openingAlreadySentForTurn(true, false, true));
  const model = new MockLanguageModelV4({ doStream: [streamed([
    ...textParts('got it, i’ll continue with the order', 'commentary', 'answer-ack'),
    { type: 'tool-call', toolCallId: 'next', toolName: 'lookup', input: '{}' },
  ], 'tool-calls')] });
  const result = streamText({ model: wrapLanguageModel({ model, middleware: commentary.middleware }), prompt: 'Yes, thanks for asking',
    tools: { lookup: tool({ inputSchema: z.object({}), execute: async () => {
      const visible = threadItems(await store.getSnapshot(run.id), await store.listMessages(run.id));
      assert.deepEqual(visible.filter(item => item.kind === 'agent').map(item => item.text), ['Should I order it anyway?', 'got it, i’ll continue with the order']);
      return { ok: true };
    } }) }, stopWhen: stepCountIs(1),
    onStepEnd: async step => { await store.appendMessages(run.id, commentary.remainingMessages(step.response.messages)); },
  });
  await result.consumeStream();
  const visible = threadItems(await store.getSnapshot(run.id), await store.listMessages(run.id));
  assert.deepEqual(visible.filter(item => item.kind === 'agent').map(item => item.text), ['Should I order it anyway?', 'got it, i’ll continue with the order']);
});
