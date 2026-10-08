import assert from "node:assert/strict";
import test from "node:test";
import { presentResultInputSchema, resultSchema } from "../lib/harness/result-schema";
import { recordAgentResult } from "../lib/harness/model";
import { MemoryRunStore } from "../lib/harness/store";
import { generateText, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const base = { outcome: "completed", summary: "Found the answer", details: "Verified against the page", verified: true, externalChange: false };

test("result boundary normalizes absent metadata and literal null without changing facts", async () => {
  const input = { ...base, moneySaved: "null", recommendedNextStep: "null", facts: [{ label: "Price", value: "$42", sourceUrl: "https://example.com/" }] };
  const value = presentResultInputSchema.parse(input);
  assert.equal(value.moneySaved, null);
  assert.equal(value.recommendedNextStep, null);
  assert.deepEqual(value.facts, input.facts);
  assert.deepEqual(value.options, []);
  const { blocksOnly, phase, ...storedValue } = value;
  assert.equal(blocksOnly, false);
  assert.deepEqual(resultSchema.parse(value), storedValue);
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "test", title: "result", request: "Research", metadata: {} });
  await recordAgentResult(store, run.id, value);
  assert.deepEqual((await store.getRun(run.id))?.result, storedValue);
});

test("result normalization rejects missing truth fields and invalid savings", () => {
  for (const field of ["outcome", "summary", "details", "verified", "externalChange"]) {
    const input: Record<string, unknown> = { ...base };
    delete input[field];
    assert.equal(presentResultInputSchema.safeParse(input).success, false, field);
  }
  for (const moneySaved of ["unknown", {}, { amount: -1, currency: "USD", cadence: "one_time", basis: "guess" }]) {
    assert.equal(presentResultInputSchema.safeParse({ ...base, moneySaved }).success, false);
  }
  assert.equal(presentResultInputSchema.parse({ ...base, verified: false }).verified, false);
  assert.equal(presentResultInputSchema.safeParse({ ...base, verified: "true" }).success, false);
  const withUnknownSource=presentResultInputSchema.parse({...base,facts:[{label:"Fact",value:"Observed"}]});
  assert.deepEqual(withUnknownSource.facts,[{label:"Fact",value:"Observed",sourceUrl:null}]);
  const { blocksOnly: _mode, phase: _phase, ...stored } = withUnknownSource;
  assert.deepEqual(resultSchema.parse(withUnknownSource),stored);
});

test("actual AI SDK tool validation accepts Muse null encoding on first call", async () => {
  let accepted = 0;
  const provider = createOpenAICompatible({ name: "meta", baseURL: "https://example.invalid/v1", apiKey: "test", fetch: async () => new Response(JSON.stringify({
    id: "test", object: "chat.completion", created: 1, model: "muse-spark-1.3",
    choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call", type: "function", function: { name: "present_result", arguments: JSON.stringify({ ...base, moneySaved: "null" }) } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { headers: { "content-type": "application/json" } }) });
  const result = await generateText({ model: provider("muse-spark-1.3"), prompt: "Record result", tools: {
    present_result: tool({ inputSchema: presentResultInputSchema, execute: async input => { accepted++; assert.equal(input.moneySaved, null); return { accepted: true }; } }),
  } });
  assert.equal(accepted, 1);
  assert.equal(result.toolResults.length, 1);
});
