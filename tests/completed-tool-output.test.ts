import assert from "node:assert/strict";
import test from "node:test";
import { streamText, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { MemoryRunStore } from "../lib/harness/store";
import { runAgent } from "../lib/harness/run";
import { appendConversationReply } from "../lib/harness/conversation-reply";
import { replayModelMessages } from "../lib/harness/context-compaction";
import { trimCompletedToolOutput } from "../lib/harness/completed-tool-output";
import { createReadToolResultTool } from "../lib/harness/read-tool-result";
import type { AgentModel, AgentMessage } from "../lib/harness/types";
import { ExecutionSliceYield } from "../lib/harness/execution-slice";

const snapshot = 'EARLY_BROWSER_PAYLOAD\n' + 'e1 button "Page detail"\n'.repeat(2000);
const stdout = 'LOG START\n' + 'x'.repeat(4000) + '\nIMPORTANT_MIDDLE_LINE\n' + 'y'.repeat(20_000) + '\nLOG END';
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const finish = { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage };
const options = { toolCallId: 'test', messages: [], context: {} };

test('ten-step browser/terminal task stays full until completion; a good-job follow-up gets compact records', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'history@test.invalid', decisionId: null, title: 'Fake browser task', category: 'test', request: 'Complete the browser task and inspect its logs', metadata: {} });
  await store.appendMessages(run.id, [{ role: 'user', content: run.request }]);
  let step = 0;
  const active = new MockLanguageModelV4({ doStream: async params => {
    step++;
    if (step >= 3) {
      const prompt = JSON.stringify(params.prompt);
      assert.ok(prompt.includes('EARLY_BROWSER_PAYLOAD'));
      assert.ok(prompt.includes('IMPORTANT_MIDDLE_LINE'));
      assert.ok(!prompt.includes('archivedOutput'), 'no trimming inside the active loop');
      assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, undefined);
    }
    return { stream: new ReadableStream({ start(controller) {
      if (step <= 10) controller.enqueue({ type: 'tool-call', toolCallId: `call-${step}`, toolName: step % 2 ? 'browser_run' : 'sandbox_run', input: '{}' });
      else {
        controller.enqueue({ type: 'text-start', id: 'answer' });
        controller.enqueue({ type: 'text-delta', id: 'answer', delta: 'Finished the fake browser task. Reference ABC123.' });
        controller.enqueue({ type: 'text-end', id: 'answer' });
      }
      controller.enqueue(finish); controller.close();
    } }) };
  } });
  const tools = {
    browser_run: tool({ inputSchema: z.object({}), execute: async () => ({ url: 'https://example.test/task', title: 'Fake task', snapshot, printed: [snapshot], confirmationId: 'ABC123', outcome: 'completed' }) }),
    sandbox_run: tool({ inputSchema: z.object({}), execute: async () => ({ stdout, stderr: '', artifacts: [{ id: 'artifact-1', name: 'result.txt' }], exitCode: 0 }) }),
  };
  const task: AgentModel = { async turn({ run, onNarration }) {
    const rows = await store.listMessages(run.id);
    const result = streamText({ model: active, messages: replayModelMessages(trimCompletedToolOutput(rows, run.metadata.completedToolHistorySeq)), tools,
      stopWhen: stepCountIs(11), onStepEnd: async result => { await store.appendMessages(run.id, result.response.messages); } });
    await result.consumeStream(); await onNarration(await result.text);
  } };
  await runAgent({ runId: run.id, store, model: task });
  assert.equal(step, 11);
  const completed = (await store.getRun(run.id))!;
  assert.equal(completed.status, 'done');
  const original: AgentMessage[] = await store.listMessages(run.id);
  assert.equal(completed.metadata.completedToolHistorySeq, original.at(-1)!.seq);
  const durableBefore = JSON.stringify(original);

  await appendConversationReply(store, run.id, 'Good job');
  const followUp = new MockLanguageModelV4({ doStream: async params => {
    const prompt = JSON.stringify(params.prompt);
    assert.ok(!prompt.includes('EARLY_BROWSER_PAYLOAD'));
    assert.ok(!prompt.includes('IMPORTANT_MIDDLE_LINE'));
    for (const kept of ['Good job', 'Reference ABC123', 'ABC123', 'https://example.test/task', 'LOG START', 'LOG END', 'artifact-1', 'read_tool_result']) assert.ok(prompt.includes(kept), kept);
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'reply' });
      controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'Thanks!' });
      controller.enqueue({ type: 'text-end', id: 'reply' }); controller.enqueue(finish); controller.close();
    } }) };
  } });
  await runAgent({ runId: run.id, store, model: { async turn({ run, onNarration }) {
    const rows = await store.listMessages(run.id);
    const result = streamText({ model: followUp, tools, messages: replayModelMessages(trimCompletedToolOutput(rows, run.metadata.completedToolHistorySeq)) });
    await result.consumeStream(); await store.appendMessages(run.id, (await result.response).messages); await onNarration(await result.text);
  } } });
  assert.equal(JSON.stringify((await store.listMessages(run.id)).slice(0, original.length)), durableBefore, 'stored evidence stays untouched');
  const trimmed = trimCompletedToolOutput(original, completed.metadata.completedToolHistorySeq);
  assert.ok(JSON.stringify(trimmed).length < durableBefore.length / 5);
  assert.deepEqual(trimCompletedToolOutput(trimmed, completed.metadata.completedToolHistorySeq), trimmed, 'stable placeholders are idempotent');
  const started = performance.now();
  for (let i = 0; i < 100; i++) JSON.stringify(trimCompletedToolOutput(original, completed.metadata.completedToolHistorySeq));
  console.info('completed-output fake-task result', { toolSteps: 10, beforeCharacters: durableBefore.length, afterCharacters: JSON.stringify(trimmed).length, averageTrimAndSerializeMs: (performance.now() - started) / 100 });

  await appendConversationReply(store, run.id, 'What was the exact middle line?');
  const terminal = original.find(row => row.message.role === 'tool' && row.message.content.some(part => part.type === 'tool-result' && part.toolName === 'sandbox_run'))!;
  const reader = createReadToolResultTool({ runId: run.id, userId: run.userId, store });
  const read = await reader.execute!({ messageId: terminal.id, toolCallId: 'call-2', field: 'stdout', offset: stdout.indexOf('IMPORTANT_MIDDLE_LINE'), limit: 22 }, options) as { content: string; nextOffset: number };
  assert.equal(read.content, 'IMPORTANT_MIDDLE_LINE\n');
  assert.ok(read.nextOffset > 0);
  const browser = original.find(row => row.message.role === 'tool' && row.message.content.some(part => part.type === 'tool-result' && part.toolName === 'browser_run'))!;
  const browserRead = await reader.execute!({ messageId: browser.id, toolCallId: 'call-1', field: 'snapshot', offset: 0, limit: 100 }, options) as { content: string };
  assert.equal(browserRead.content, snapshot.slice(0, 100));
  const foreign = await store.createRun({ userId: run.userId, decisionId: null, title: 'Other', category: 'test', request: 'Other', metadata: {} });
  const [foreignMessage] = await store.appendMessages(foreign.id, [terminal.message]);
  await assert.rejects(async () => reader.execute!({ messageId: foreignMessage.id, toolCallId: 'call-2', field: 'stdout', offset: 0, limit: 20 }, options), /not found in this chat/);
  const actionCount = (await store.getSnapshot(run.id))!.actions.length;
  const wrongOwner = createReadToolResultTool({ runId: run.id, userId: 'other@test.invalid', store });
  await assert.rejects(async () => wrongOwner.execute!({ messageId: terminal.id, toolCallId: 'call-2', field: 'stdout', offset: 0, limit: 20 }, options), /unavailable/);
  assert.equal((await store.getSnapshot(run.id))!.actions.length, actionCount);
});

test('pauses, failures and unfinished work do not create a trimming boundary', async () => {
  for (const status of ['paused', 'awaiting_approval', 'failed'] as const) {
    const store = new MemoryRunStore();
    const run = await store.createRun({ userId: 'paused@test.invalid', decisionId: null, title: 'Open', category: 'test', request: 'Continue', metadata: {} });
    await store.appendMessages(run.id, [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'open', toolName: 'browser_run', output: { type: 'json', value: { snapshot } } }] }]);
    await store.updateRun(run.id, { status });
    const rows = await store.listMessages(run.id);
    assert.equal(trimCompletedToolOutput(rows, (await store.getRun(run.id))?.metadata.completedToolHistorySeq), rows);
    await appendConversationReply(store, run.id, 'Continue');
    assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, undefined);
  }
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'question@test.invalid', decisionId: null, title: 'Question', category: 'test', request: 'Book it', metadata: {} });
  await store.updateRun(run.id, { status: 'running' });
  await store.appendMessages(run.id, [{ role: 'assistant', content: 'Which date?' }]);
  await store.finishRunIfNoSteering(run.id, { outcome: 'needs_user', summary: 'Which date?', details: '', verified: false, externalChange: false, facts: [], links: [], moneySaved: null, recommendedNextStep: null });
  await appendConversationReply(store, run.id, 'Tomorrow');
  assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, undefined);
});

test('new tool results remain full beyond the previous completed boundary, including errors', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'boundary@test.invalid', decisionId: null, title: 'Test', category: 'test', request: 'Test', metadata: {} });
  const output = { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: 'a', toolName: 'sandbox_run', output: { type: 'json' as const, value: { stdout, stderr: 'FAILURE '.repeat(1000), $toolError: true } } }] };
  const rows = await store.appendMessages(run.id, [output, output]);
  const trimmed = trimCompletedToolOutput(rows, 1);
  assert.deepEqual(trimmed[1], rows[1]);
  assert.ok(JSON.stringify(trimmed[0]).includes('FAILURE '.repeat(1000)), 'failure diagnostics remain complete');
});

test('yielding to another worker slice does not mark an active task as completed', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'slice@test.invalid', decisionId: null, title: 'Task', category: 'test', request: 'Keep working', metadata: {} });
  const outcome = await runAgent({ runId: run.id, store, model: { async turn() {
    await store.appendMessages(run.id, [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'active', toolName: 'browser_run', output: { type: 'json', value: { snapshot } } }] }]);
    throw new ExecutionSliceYield();
  } } });
  assert.ok(outcome?.retryAfterMs);
  assert.equal((await store.getRun(run.id))?.status, 'running');
  assert.equal((await store.getRun(run.id))?.metadata.completedToolHistorySeq, undefined);
  const rows = await store.listMessages(run.id);
  assert.equal(trimCompletedToolOutput(rows, undefined), rows);
});
