import test from "node:test";
import assert from "node:assert/strict";
import { createAppleActionExecutor } from "../app/apple-action-executor";

test("Home runner and an opened conversation share one in-flight native execution", async () => {
  const executor = createAppleActionExecutor<boolean>();
  let calls = 0, complete!: (value: boolean) => void;
  const start = () => { calls++; return new Promise<boolean>(resolve => { complete = resolve; }); };
  const home = executor.execute("run:action", start);
  const conversation = executor.execute("run:action", start);
  const retryWhileRunning = executor.execute("run:action", start, true);
  assert.equal(home, conversation); assert.equal(home, retryWhileRunning);
  await Promise.resolve(); assert.equal(calls, 1);
  complete(true); assert.deepEqual(await Promise.all([home, conversation]), [true, true]);
  assert.equal(await executor.execute("run:action", start), true); assert.equal(calls, 1);
});

test("background execution failure survives navigation and only an explicit retry restarts transport", async () => {
  const executor = createAppleActionExecutor<boolean>(); let calls = 0;
  const start = async () => { if (++calls === 1) throw new Error("Device unavailable"); return true; };
  await assert.rejects(executor.execute("run:action", start), /Device unavailable/);
  await assert.rejects(executor.execute("run:action", start), /Device unavailable/);
  assert.equal(calls, 1);
  assert.equal(await executor.execute("run:action", start, true), true); assert.equal(calls, 2);
});

test("server completion cannot evict an in-flight native reply before a pending snapshot returns", async () => {
  const executor = createAppleActionExecutor<boolean>();
  let calls = 0, finish!: (value: boolean) => void;
  const start = () => { calls++; return new Promise<boolean>(resolve => { finish = resolve; }); };
  const original = executor.execute("run:weather", start);
  await Promise.resolve();
  executor.retain(new Set());
  const remounted = executor.execute("run:weather", start);
  assert.equal(remounted, original);
  assert.equal(calls, 1);
  finish(true);
  assert.deepEqual(await Promise.all([original, remounted]), [true, true]);
});

test("different actions are independent and only inactive receipts are cleared", async () => {
  const executor = createAppleActionExecutor<number>(); let calls = 0;
  const start = async () => ++calls;
  assert.equal(await executor.execute("run:first", start), 1);
  assert.equal(await executor.execute("run:second", start), 2);
  executor.retain(new Set(["run:second"]));
  assert.equal(await executor.execute("run:second", start), 2);
  assert.equal(await executor.execute("run:first", start), 3);
});
