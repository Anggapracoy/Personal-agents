import test from "node:test";
import assert from "node:assert/strict";
import { streamText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { MemoryRunStore } from "../lib/harness/store.ts";
import { agentTurnStopCondition } from "../lib/harness/turn-stop-condition.ts";

async function exercise(onTool = async () => {}, turnEnded = () => false) {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "loop-test", decisionId: null, category: "evaluation", title: "Long task", request: "Finish the long task", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    const step = ++calls;
    if (step <= 65) controller.enqueue({ type: "tool-call", toolCallId: `call-${step}`, toolName: "lookup", input: "{}" });
    else {
      controller.enqueue({ type: "text-start", id: "answer" });
      controller.enqueue({ type: "text-delta", id: "answer", delta: "Verified all 65 steps." });
      controller.enqueue({ type: "text-end", id: "answer" });
    }
    controller.enqueue({ type: "finish", finishReason: { unified: step <= 65 ? "tool-calls" : "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } });
    controller.close();
  } }) }) });
  const result = streamText({
    model, prompt: run.request,
    stopWhen: agentTurnStopCondition(store, run.id, turnEnded),
    tools: { lookup: tool({ inputSchema: z.object({}), execute: async () => {
      await onTool(calls, store, run.id);
      return { step: calls };
    } }) },
  });
  await result.consumeStream();
  return { calls, text: await result.text };
}

test("agent loop completes 65 tool steps and still produces its final answer", async () => {
  const result = await exercise();
  assert.equal(result.calls, 66);
  assert.equal(result.text, "Verified all 65 steps.");
});

for (const status of ["paused", "awaiting_approval", "cancelled"]) {
  test(`uncapped loop still stops for ${status} after step 45`, async () => {
    const result = await exercise(async (step, store, id) => {
      if (step === 45) await store.updateRun(id, { status });
    });
    assert.equal(result.calls, 45);
    assert.equal(result.text, "");
  });
}

for (const metadata of [{ pendingSteering: [{ role: "user", content: "Change destination" }] }, { runtimeResultSeq: 2, runtimeResultReadSeq: 1 }]) {
  test(`uncapped loop yields for incoming context: ${Object.keys(metadata)[0]}`, async () => {
    const result = await exercise(async (step, store, id) => {
      if (step === 45) await store.updateRunMetadata(id, metadata);
    });
    assert.equal(result.calls, 45);
  });
}

test("uncapped loop honors completion or persistence failure in the current turn", async () => {
  let ended = false;
  const result = await exercise(async step => { ended = step === 45; }, () => ended);
  assert.equal(result.calls, 45);
});
