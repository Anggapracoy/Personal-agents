import test from "node:test";
import assert from "node:assert/strict";
import { getOwnedRun } from "../lib/auth/owned-run";
import { getRunStore } from "../lib/harness/store";

test("lightweight run authorization preserves anonymous and cross-account boundaries", async () => {
  const store = getRunStore();
  const run = await store.createRun({ userId: "owner@example.invalid", decisionId: null, title: "Test", request: "Test", category: "test", metadata: {} });
  assert.equal((await getOwnedRun(run.id, null)).status, 401);
  const other = await getOwnedRun(run.id, { user: { email: "other@example.invalid" } });
  assert.equal(other.status, 404); assert.equal(other.run, null);
  const owner = await getOwnedRun(run.id, { user: { email: " Owner@Example.Invalid " } });
  assert.equal(owner.status, 200); assert.equal(owner.run?.id, run.id);
});
