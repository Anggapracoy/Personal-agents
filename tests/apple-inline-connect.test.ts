import test from "node:test";
import assert from "node:assert/strict";
import { appleActionSource, usableAppleConnection, connectAndContinueAppleAction } from "../app/apple-action-connection";
import type { AppleConnection } from "../lib/apple/catalog";
const connected: AppleConnection = { id: "reminders", enabled: true, status: "connected" };
test("inline connection waits for permission, then continues the same action once", async () => {
  const order: string[] = [];
  let grant!: (connections: AppleConnection[]) => void;
  const run = connectAndContinueAppleAction("reminders", {
    connect: service => { assert.equal(service, "reminders"); order.push("permission"); return new Promise(resolve => { grant = resolve; }); },
    onConnected: () => order.push("connected"), isCurrent: () => true,
    execute: async () => { order.push("execute original action"); return true; },
  });
  assert.deepEqual(order, ["permission"]);
  grant([connected]);
  assert.equal(await run, true);
  assert.deepEqual(order, ["permission", "connected", "execute original action"]);
});
test("denied, missing, cancelled and stale inline connections never execute", async () => {
  let calls = 0;
  const input = { onConnected: () => {}, isCurrent: () => true, execute: async () => { calls++; return true; } };
  for (const connections of [[], [{ ...connected, enabled: false }], [{ ...connected, status: "denied" as const }]]) {
    await assert.rejects(connectAndContinueAppleAction("reminders", { ...input, connect: async () => connections }));
  }
  await assert.rejects(connectAndContinueAppleAction("reminders", { ...input, connect: async () => { throw new Error("Picker cancelled"); } }));
  assert.equal(await connectAndContinueAppleAction("reminders", { ...input, connect: async () => [connected], isCurrent: () => false }), false);
  assert.equal(calls, 0);
});
test("all Apple operations select their source and selected-item access is usable", () => {
  assert.equal(appleActionSource("reminders.create")?.name, "Reminders");
  assert.equal(appleActionSource("photos.read")?.id, "photos");
  assert.equal(appleActionSource("unknown.write"), undefined);
  assert.equal(usableAppleConnection({ id: "photos", enabled: true, status: "limited" }), true);
  assert.equal(usableAppleConnection({ id: "photos", enabled: false, status: "limited" }), false);
});
