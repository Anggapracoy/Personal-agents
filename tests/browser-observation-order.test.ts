import assert from "node:assert/strict";
import test from "node:test";
import { tool, type ModelMessage } from "ai";
import { z } from "zod";
import { orderedBrowserTools } from "../lib/harness/browser/tool-order";
import { withBrowserVision } from "../lib/harness/browser/vision";
import { MemoryRunStore } from "../lib/harness/store";

const options = { toolCallId: "test", messages: [], context: undefined };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("a browser batch preserves preflight/action/capture order while unrelated tools remain concurrent", async () => {
  const entered = gate(), release = gate();
  const events: string[] = [];
  const tools = orderedBrowserTools({
    browser_type: tool({ inputSchema: z.object({}), execute: async () => {
      events.push("type preflight"); entered.resolve(); await release.promise;
      events.push("type mutation", "type capture"); return "typed";
    } }),
    browser_check: tool({ inputSchema: z.object({}), execute: async () => { events.push("check mutation", "check capture"); return "checked"; } }),
    search: tool({ inputSchema: z.object({}), execute: async () => { events.push("search"); return "found"; } }),
  });
  const first = tools.browser_type.execute!({}, options);
  const second = tools.browser_check.execute!({}, options);
  await entered.promise;
  await tools.search.execute!({}, options);
  assert.deepEqual(events, ["type preflight", "search"]);
  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["type preflight", "search", "type mutation", "type capture", "check mutation", "check capture"]);
});

test("a failed action stops the batch and recovery requires a new model step", async () => {
  const entered = gate(), release = gate(), controller = new AbortController();
  let writes = 0;
  const batch = { failed: false };
  const tools = orderedBrowserTools({
    browser_open: tool({ inputSchema: z.object({}), execute: async (): Promise<string> => { entered.resolve(); await release.promise; throw new Error("navigation failed"); } }),
    browser_type: tool({ inputSchema: z.object({}), execute: async () => { writes++; return "typed"; } }),
  }, batch);
  const first = assert.rejects(async () => { await tools.browser_open.execute!({}, options); }, /navigation failed/);
  const second = assert.rejects(async () => { await tools.browser_type.execute!({}, options); }, /prior browser action/);
  await entered.promise; controller.abort(); release.resolve();
  await Promise.all([first, second]);
  assert.equal(writes, 0);
  batch.failed = false;
  await assert.rejects(async () => { await tools.browser_type.execute!({}, { ...options, abortSignal: controller.signal }); }, /abort/i);
  await tools.browser_type.execute!({}, options);
  assert.equal(writes, 1);
});

test("fresh batch observation supersedes out-of-order historical frames and snapshots without changing receipts", async () => {
  const store = new MemoryRunStore();
  const artifact = await store.createArtifact({ runId: "order", actionId: null, name: "current.png", mimeType: "image/png", bytesBase64: "Y3VycmVudA==" });
  const messages: ModelMessage[] = [{ role: "user", content: "Fill the form" }, { role: "tool", content: [
    { type: "tool-result", toolName: "browser_type", toolCallId: "type", output: { type: "json", value: { snapshot: "filled", browserFrame: { id: "later" } } } },
    { type: "tool-result", toolName: "browser_check", toolCallId: "check", output: { type: "json", value: { snapshot: "empty", browserFrame: { id: "earlier" } } } },
  ] }];
  const before = JSON.stringify(messages);
  let observations = 0;
  const prepared = await withBrowserVision(messages, store, "order", async () => {
    observations++; return { imageId: artifact.id, pageUrl: "https://example.com", snapshot: "Both text fields filled; checkbox checked" };
  });
  assert.equal(observations, 1);
  assert.equal(JSON.stringify(messages), before);
  const observation = JSON.stringify(prepared.at(-1));
  assert.match(observation, /Both text fields filled; checkbox checked/);
  assert.match(observation, /historical receipts/);
  assert.match(observation, /Y3VycmVudA==/);
  assert.doesNotMatch(observation, /earlier|empty/);
});

test("failed refresh never falls back to old pixels; secure and failed tool observations never trigger a capture", async () => {
  const store = new MemoryRunStore();
  const artifact = await store.createArtifact({ runId: "safe", actionId: null, name: "old.png", mimeType: "image/png", bytesBase64: "b2xk" });
  const messages: ModelMessage[] = [{ role: "tool", content: [{ type: "tool-result", toolName: "browser_open", toolCallId: "open", output: { type: "json", value: { snapshot: "old page", browserFrame: { id: artifact.id } } } }] }];
  const failure = await withBrowserVision(messages, store, "safe", async () => { throw new Error("capture failed"); });
  assert.match(JSON.stringify(failure.at(-1)), /fresh observation.*failed/);
  assert.doesNotMatch(JSON.stringify(failure.at(-1)), /b2xk/);
  for (const output of [{ type: "json" as const, value: { snapshot: "secure field verified" } }, { type: "error-text" as const, value: "navigation failed" }]) {
    const latest: ModelMessage[] = [...messages, { role: "tool", content: [{ type: "tool-result", toolName: "browser_fill_login", toolCallId: "secure", output }] }];
    assert.deepEqual(await withBrowserVision(latest, store, "safe", async () => { assert.fail("must not capture"); }), latest);
  }
});

test("viewer frames remain text-only; explicit screenshots deliver pixels and are invalidated by newer browser calls", async () => {
  const store = new MemoryRunStore();
  const artifact = await store.createArtifact({ runId: "demand", actionId: null, name: "requested.png", mimeType: "image/png", bytesBase64: "cGl4ZWxz" });
  const result = (toolName: string, value: Record<string, string | { id: string }>): ModelMessage => ({ role: "tool", content: [{ type: "tool-result", toolName, toolCallId: toolName, output: { type: "json", value } }] });
  const viewer = [result("browser_inspect", { snapshot: "Price $59.99", browserFrame: { id: artifact.id } })];
  assert.deepEqual(await withBrowserVision(viewer, store, "demand"), viewer);
  const requested = [result("browser_screenshot", { actualUrl: "https://example.com", snapshot: "Price $59.99", artifact: { id: artifact.id } })];
  const prepared = await withBrowserVision(requested, store, "demand");
  assert.equal(prepared.length, 2);
  assert.match(JSON.stringify(prepared.at(-1)), /cGl4ZWxz/);
  assert.deepEqual(await withBrowserVision(prepared, store, "demand"), prepared);
  assert.deepEqual(await withBrowserVision(requested, store, "another-run"), requested);
  for (const newer of [
    result("browser_inspect", { snapshot: "new page", browserFrame: { id: artifact.id } }),
    result("browser_switch_tab", { url: "https://example.org" }),
    result("browser_fill_login", { status: "filled" }),
    { role: "tool", content: [{ type: "tool-result", toolName: "browser_open", toolCallId: "failed", output: { type: "error-text", value: "navigation failed" } }] } as ModelMessage,
    { role: "user", content: "New request" } as ModelMessage,
  ]) {
    assert.deepEqual(await withBrowserVision([...prepared, newer], store, "demand"), [...requested, newer]);
  }
  const unrelated = result("sandbox_run", { stdout: "calculated" });
  assert.equal((await withBrowserVision([...requested, unrelated], store, "demand")).length, 3);
});
