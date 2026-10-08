import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitDelay } from "../lib/harness/rate-limit";
import { runAgent } from "../lib/harness/run";
import { MemoryRunStore } from "../lib/harness/store";
import { streamText, wrapLanguageModel } from "ai";
import { storedOpenAIModel } from "../lib/harness/stored-openai";
import { providerFailureMiddleware, type ProviderFailureDiagnostic } from "../lib/harness/provider-error";

const throttle = () => Object.assign(new Error("Rate limit reached for gpt-5.6-terra on tokens per min"), { statusCode: 429 });

test("provider throttles wait at least a minute and honor longer Retry-After", () => {
  assert.equal(rateLimitDelay(throttle()), 60_000);
  assert.equal(rateLimitDelay({ lastError: throttle() }), 60_000);
  assert.equal(rateLimitDelay({ statusCode: 429, responseHeaders: { "retry-after": "90" } }), 90_000);
  assert.equal(rateLimitDelay({ statusCode: 429, responseHeaders: { "retry-after-ms": "120000" } }), 120_000);
  assert.equal(rateLimitDelay({ statusCode: 429, responseBody: '{"error":{"code":"insufficient_quota"}}' }), null);
  assert.equal(rateLimitDelay(new Error("Invalid API key")), null);
});

test("Responses stream throttling after compaction resumes instead of failing the run", async () => {
  // The Natura failure was HTTP 200, then response.failed after a compaction
  // output. Exercise the installed adapter: its error is a plain nested object.
  const events = [
    { type: "response.created", response: { id: "resp_throttled", model: "gpt-6-sol", created_at: 1 } },
    { type: "response.in_progress", response: { id: "resp_throttled" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "compaction", id: "cmp_test", encrypted_content: "" } },
    { type: "response.output_item.done", output_index: 0, item: { type: "compaction", id: "cmp_test", encrypted_content: "encrypted-checkpoint" } },
    { type: "response.failed", sequence_number: 5, response: { id: "resp_throttled", error: {
      code: "rate_limit_exceeded",
      message: "Rate limit reached for gpt-6-sol on tokens per min (TPM): Limit 500000, Used 461092, Requested 200268. Please try again in 19.363s.",
      headers: { "retry-after": "20", "retry-after-ms": "19363" },
    }, usage: null } },
  ];
  const sdk = storedOpenAIModel("gpt-6-sol", { apiKey: "test", fetch: async () => new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "x-request-id": "req_throttled" } },
  ) });
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "stream-throttle", decisionId: null, category: "test", request: "Continue", title: "Checkout", metadata: {} });
  await store.appendMessages(run.id, [{ role: "user", content: "Saved checkout progress" }]);
  await store.putSecret(run.id, "card_release", "retained");
  const failures: ProviderFailureDiagnostic[] = [];
  const observedModel = wrapLanguageModel({ model: sdk, middleware: providerFailureMiddleware(async failure => { failures.push(failure); }) });
  let calls = 0;
  const model = { async turn({ onNarration }: { onNarration: (text: string) => Promise<void> }) {
    if (++calls > 1) { await onNarration("Resumed from saved progress."); return; }
    const result = streamText({ model: observedModel, prompt: "Continue", maxRetries: 0, includeRawChunks: true, onError: () => {} });
    for await (const part of result.fullStream) {
      if (part.type === "error") {
        assert.equal(part.error instanceof Error, false);
        throw part.error;
      }
    }
    assert.fail("Expected the recorded stream failure");
  } };
  assert.deepEqual(await runAgent({ runId: run.id, store, model }), { retryAfterMs: 60_000 });
  assert.deepEqual(failures, [{ code: "rate_limit_exceeded", type: "response.failed", status: null, requestId: "req_throttled", responseId: "resp_throttled" }]);
  assert.equal((await store.getRun(run.id))?.status, "running");
  assert.equal((await store.getRun(run.id))?.error, null);
  assert.equal(await store.getSecret(run.id, "card_release"), "retained");
  assert.ok((await runAgent({ runId: run.id, store, model }))!.retryAfterMs > 59_000);
  assert.equal(calls, 1);
  await store.updateRunMetadata(run.id, { modelRetryAt: Date.now() - 1 });
  await runAgent({ runId: run.id, store, model });
  assert.equal((await store.getRun(run.id))?.status, "done");
  assert.equal((await store.listMessages(run.id)).length, 1);
});

test("nested provider errors honor retry headers and do not retry quota or permanent failures", () => {
  assert.equal(rateLimitDelay({ type: "error", error: { code: "rate_limit_exceeded", message: "Slow down", headers: { "retry-after": "90" } } }), 90_000);
  assert.equal(rateLimitDelay({ type: "response.failed", response: { error: { code: "rate_limit_exceeded", message: "Slow down", headers: { "retry-after-ms": "120000" } } } }), 120_000);
  assert.equal(rateLimitDelay({ statusCode: 429, response: { error: { code: "insufficient_quota", message: "Quota exhausted" } } }), null);
  assert.equal(rateLimitDelay({ response: { error: { code: "invalid_request_error", message: "Invalid input" } } }), null);
});

test("repeated rate limits retain progress and secrets, suppress early dispatch, then continue", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "evaluation", request: "Continue", title: "Retry", metadata: {} });
  await store.putSecret(run.id, "test_secret", "retained");
  await store.appendMessages(run.id, [{ role: "user", content: "Saved progress" }]);
  let turns = 0;
  const model = { async turn({ onNarration }: { onNarration: (text: string) => Promise<void> }) {
    turns += 1;
    if (turns <= 4) throw throttle();
    await onNarration("Finished from saved progress.");
  } };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const outcome = await runAgent({ runId: run.id, store, model });
    assert.equal(outcome?.retryAfterMs, 60_000);
    assert.equal((await store.getRun(run.id))?.status, "running");
    assert.equal((await store.getRun(run.id))?.error, null);
    assert.equal(await store.getSecret(run.id, "test_secret"), "retained");
    const early = await runAgent({ runId: run.id, store, model });
    assert.ok(early && early.retryAfterMs > 59_000);
    assert.equal(turns, attempt + 1);
    await store.updateRunMetadata(run.id, { modelRetryAt: Date.now() - 1 });
  }
  await runAgent({ runId: run.id, store, model });
  assert.equal((await store.getRun(run.id))?.status, "done");
  assert.equal((await store.listMessages(run.id)).length, 1);
});

test("cancellation during cooldown prevents another model call", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "evaluation", request: "Continue", title: "Retry", metadata: {} });
  let turns = 0;
  const model = { async turn() { turns += 1; throw throttle(); } };
  await runAgent({ runId: run.id, store, model });
  await store.updateRun(run.id, { status: "cancelled" });
  await runAgent({ runId: run.id, store, model });
  assert.equal(turns, 1);
});
