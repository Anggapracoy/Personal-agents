import { test } from "node:test";
import assert from "node:assert/strict";
import { callSummary, includeCallSummaries } from "../lib/harness/call-summary";
import { threadItems } from "../lib/harness/thread";
import { MemoryRunStore } from "../lib/harness/store";
import type { AgentAction } from "../lib/harness/types";

const call = { id: "call-action", toolName: "phone_call", status: "executed", executedAt: "2026-09-10T12:01:00Z", input: { request: { recipientName: "Restaurant", phoneNumber: "+12125550100", task: "private call brief" } }, result: { callId: "provider-call", callResult: { status: "completed", started_at: "2026-09-10T12:01:00Z", ended_at: "2026-09-10T12:02:13Z", summary: "A table for two is confirmed for 7 PM.", transcript: "raw transcript" } } } as unknown as AgentAction;
test("only terminal owned call receipts become a summary", () => {
  const result = callSummary(call)!;
  assert.equal(result.recipient, "Restaurant");
  assert.equal(result.durationSeconds, 73);
  assert.ok(!JSON.stringify(result).includes("A table"));
  assert.ok(!JSON.stringify(result).includes("private call brief"));
  assert.ok(!JSON.stringify(result).includes("raw transcript"));
  assert.equal(callSummary({ ...call, status: "proposed" }), null);
  assert.equal(callSummary({ ...call, result: { callId: "provider-call", callResult: { status: "in_progress" } } }), null);
  assert.equal(callSummary({ ...call, result: { callId: "provider-call", callResult: { status: "error" } } })?.failed, true);
});
test("missing and malformed summaries do not invent success", () => {
  const summary = callSummary({ ...call, result: { callId: "provider-call", callResult: { status: "completed", summary: { raw: "not text" } } } })!;
  assert.equal(summary.durationSeconds, undefined);
});
test("legacy result actions match their exact call and never duplicate its panel", () => {
  const started = { ...call, result: { callId: "provider-call" } };
  const receipt = { ...call, id: "result", toolName: "phone_call_result", input: { callId: "another-call" }, result: { status: "completed", summary: "Wrong call" } };
  assert.equal(callSummary(started, [receipt]), null);
  receipt.input.callId = "provider-call";
  assert.equal(callSummary(started, [receipt])?.recipient, "Restaurant");
  const before = { id: "before", createdAt: "2026-09-10T12:00:00Z" };
  const after = { id: "after", createdAt: "2026-09-10T12:02:00Z" };
  const result = includeCallSummaries([callSummary(call)!, before, after], [call]);
  assert.deepEqual(result.map(item => item.id), ["before", "call:call-action", "after"]);
  assert.deepEqual(includeCallSummaries(result, [call]), result);
});
test("completed call survives message checkpoint omission and later replies", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, title: "Call", category: "social", request: "Book dinner", metadata: {} });
  const snapshot = (await store.getSnapshot(run.id))!;
  snapshot.actions = [call]; snapshot.status = "done";
  assert.equal(threadItems(snapshot, [])[0].kind, "call");
});
