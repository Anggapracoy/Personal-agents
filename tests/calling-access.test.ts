import assert from "node:assert/strict";
import test from "node:test";
import { callingEnabled, callingPolicySchema, defaultCallingPolicy } from "../lib/calling-policy";

const admin = "admin@example.com";
test("calling modes apply normalized per-email overrides and No one is a global stop", () => {
  assert.equal(callingEnabled(defaultCallingPolicy, admin.toUpperCase()), true);
  assert.equal(callingEnabled(defaultCallingPolicy, "alex@example.com"), true);
  const policy = callingPolicySchema.parse({ mode: "selected", revision: 0, users: [{ email: " Alex@Example.com ", enabled: true }, { email: admin, enabled: false }] });
  assert.equal(callingEnabled(policy, " ALEX@example.com "), true);
  assert.equal(callingEnabled(policy, admin), false);
  assert.equal(callingEnabled({ ...policy, mode: "everyone" }, "new@example.com"), true);
  assert.equal(callingEnabled({ ...policy, mode: "everyone" }, admin), false);
  for (const email of [admin, "alex@example.com", "new@example.com"]) assert.equal(callingEnabled({ ...policy, mode: "none" }, email), false);
  assert.equal(callingEnabled({ mode: "selected", users: [], revision: 1 }, "alex@example.com"), false);
  assert.equal(callingEnabled({ mode: "everyone", users: [], revision: 1 }, "alex@example.com"), true);
});
test("policy rejects duplicate normalized emails, invalid entries, and stale revision shapes", () => {
  assert.equal(callingPolicySchema.safeParse({ mode: "all", users: [], revision: 0 }).success, false);
  assert.equal(callingPolicySchema.safeParse({ mode: "selected", users: [{ email: "not-an-email", enabled: true }], revision: 0 }).success, false);
  assert.equal(callingPolicySchema.safeParse({ mode: "selected", users: [{ email: "A@example.com", enabled: true }, { email: "a@example.com", enabled: false }], revision: 0 }).success, false);
  assert.equal(callingPolicySchema.safeParse({ mode: "selected", users: [], revision: -1 }).success, false);
});

test('missing policy rows enable calling, proactive work and rich results', async () => {
  const { CallingAccessStore } = await import('../lib/calling-access');
  const { isMorningAllowed } = await import('../lib/proactive/morning-access');
  const client = (async () => []) as unknown as import('postgres').Sql;
  for (const key of ['voice_calling', 'daily_proactive', 'rich_result_blocks'] as const) {
    assert.equal(callingEnabled(await new CallingAccessStore(client, key).read(), 'new@example.invalid'), true);
  }
  assert.equal(await isMorningAllowed('new@example.invalid', {execute: async () => []} as never), true);
  assert.equal(callingEnabled(defaultCallingPolicy, ''), false);
});
