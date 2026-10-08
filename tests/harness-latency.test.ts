import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTick } from "node:timers/promises";
import { createBatchedNarration } from "../lib/harness/narration";
import { timedRunStore, withHarnessTiming, timeHarnessOperation } from "../lib/harness/timing";
import { MemoryRunStore } from "../lib/harness/store";
import { syncInngest } from "../scripts/sync-inngest.mjs";

test("narration persists first text immediately, coalesces bursts, and flushes its tail", async () => {
  const writes: string[] = [];
  const narration = createBatchedNarration(async delta => { writes.push(delta); }, 60_000);
  await narration.append("first");
  assert.deepEqual(writes, ["first"]);
  for (const delta of [" second", " third", " fourth"]) await narration.append(delta);
  assert.deepEqual(writes, ["first"]);
  await narration.close();
  assert.deepEqual(writes, ["first", " second third fourth"]);
  await assert.rejects(narration.append("late"), /closed/);
});

test("narration flushes during a pause in incoming tokens", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const writes: string[] = [];
  const narration = createBatchedNarration(async delta => { writes.push(delta); }, 100);
  await narration.append("a");
  await narration.append("b");
  t.mock.timers.tick(99);
  await nextTick();
  assert.deepEqual(writes, ["a"]);
  t.mock.timers.tick(1);
  await nextTick();
  assert.deepEqual(writes, ["a", "b"]);
  await narration.close();
});

test("concurrent flush and close cannot reorder or overlap writes", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let active = 0;
  let maxActive = 0;
  const writes: string[] = [];
  const narration = createBatchedNarration(async delta => {
    maxActive = Math.max(maxActive, ++active);
    if (delta === "a") await gate;
    writes.push(delta);
    active--;
  }, 60_000);
  const first = narration.append("a");
  await nextTick();
  await narration.append("b");
  const flush = narration.flush();
  await narration.append("c");
  const close = narration.close();
  release();
  await Promise.all([first, flush, close]);
  assert.equal(maxActive, 1);
  assert.equal(writes.join(""), "abc");
});

test("a background persistence failure reaches close instead of silently losing text", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const narration = createBatchedNarration(async delta => { if (delta === "b") throw new Error("database unavailable"); });
  await narration.append("a");
  await narration.append("b");
  t.mock.timers.tick(100);
  await nextTick();
  await assert.rejects(narration.close(), /database unavailable/);
});

test("operation timing records no messages, arguments or returned secrets", async () => {
  const before = process.env.HARNESS_TIMING;
  process.env.HARNESS_TIMING = "1";
  const log = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    const store = timedRunStore(new MemoryRunStore());
    await withHarnessTiming("test", "diagnostic-run-id", async () => {
      await store.createRun({ userId: "private-email", decisionId: null, category: "test", title: "private-title", request: "private-message", metadata: { token: "secret-value" } });
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /store.createRun/);
    assert.doesNotMatch(lines[0], /private-|secret-value/);
  } finally {
    console.info = log;
    if (before === undefined) delete process.env.HARNESS_TIMING; else process.env.HARNESS_TIMING = before;
  }
});

test("deployment registration fails loudly on a rejected sync", async () => {
  await assert.rejects(syncInngest("https://example.test", async () => new Response("unavailable", { status: 503 })), /503/);
  await assert.rejects(syncInngest("https://example.test", async () => Response.json({ error: "rejected" })), /rejected/);
  const calls: Array<{ url: string; method?: string }> = [];
  await syncInngest("https://example.test/somewhere", async (url, options) => { calls.push({ url: String(url), method: options?.method }); return Response.json({ message: "Successfully registered" }); });
  assert.deepEqual(calls, [{ url: "https://example.test/api/inngest", method: "PUT" }]);
});

test("new-chat timing associates earlier spans with the ID assigned later, including failures", async t => {
  const before = process.env.HARNESS_TIMING;
  process.env.HARNESS_TIMING = "1";
  t.after(() => { if (before === undefined) delete process.env.HARNESS_TIMING; else process.env.HARNESS_TIMING = before; });
  const traces: Array<{ runId?: string; failed: boolean; spans: Array<{ name: string }> }> = [];
  t.mock.method(console, "info", (_prefix: string, data: string) => traces.push(JSON.parse(data)));
  for (const fail of [false, true]) {
    let runId: string | undefined;
    const work = withHarnessTiming("create", () => runId, async () => {
      await timeHarnessOperation("auth.session", async () => "private-session");
      runId = fail ? "failed-created-run" : "successful-created-run";
      return timeHarnessOperation("inngest.dispatch", async () => {
        if (fail) throw new Error("private-upstream-error");
        return "private-result";
      });
    });
    if (fail) await assert.rejects(work, /private-upstream-error/);
    else assert.equal(await work, "private-result");
  }
  assert.deepEqual(traces.map(trace => trace.runId), ["successful-created-run", "failed-created-run"]);
  assert.deepEqual(traces.map(trace => trace.failed), [false, true]);
  for (const trace of traces) assert.deepEqual(trace.spans.map(span => span.name), ["auth.session", "inngest.dispatch"]);
  assert.doesNotMatch(JSON.stringify(traces), /private-/);
});

test("a rejected request without a created run keeps its response and does not invent a run ID", async t => {
  const before = process.env.HARNESS_TIMING;
  process.env.HARNESS_TIMING = "1";
  t.after(() => { if (before === undefined) delete process.env.HARNESS_TIMING; else process.env.HARNESS_TIMING = before; });
  const traces: Record<string, unknown>[] = [];
  t.mock.method(console, "info", (_prefix: string, data: string) => traces.push(JSON.parse(data)));
  const response = await withHarnessTiming("create", () => undefined, async () => new Response(null, { status: 401 }));
  assert.equal(response.status, 401);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].runId, undefined);
});
