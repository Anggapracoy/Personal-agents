import assert from "node:assert/strict";
import test from "node:test";
import { shouldCloseBrowserForAttention } from "../app/browser-sheet-attention";
import type { RunningTask } from "../lib/types";
import type { AgentRunSnapshot } from "../lib/harness/types";

const openedAt = Date.parse("2026-09-22T01:00:00.000Z");
const opened = { actionId: "existing-approval", agentMessageIds: ["opening"], openedAt };
const task = (status: RunningTask["status"], actionId?: string) => ({ status, actionId }) as RunningTask;
const snapshot = (id: string, createdAt = "2026-09-22T01:00:01.000Z") => ({
  threadItems: [{ kind: "agent", id, text: "Update", createdAt }],
}) as AgentRunSnapshot;

test("browser dismisses for a newly requested approval, including payment and purchase", () => {
  assert.equal(shouldCloseBrowserForAttention(opened, task("needs_approval", "new-payment"), undefined), true);
  assert.equal(shouldCloseBrowserForAttention(opened, task("needs_approval", "new-purchase"), undefined), true);
  assert.equal(shouldCloseBrowserForAttention(opened, task("needs_approval", "existing-approval"), undefined), false);
});

test("an active manual takeover stays open when the agent requests takeover", () => {
  const takeover = { ...task("needs_approval", "new-takeover"), approvalKind: "takeover" } as RunningTask;
  assert.equal(shouldCloseBrowserForAttention(opened, takeover, undefined, true), false);
  assert.equal(shouldCloseBrowserForAttention(opened, takeover, undefined, false), true);
  const purchase = { ...task("needs_approval", "new-purchase"), approvalKind: "purchase" } as RunningTask;
  assert.equal(shouldCloseBrowserForAttention(opened, purchase, undefined, true), true);
});

test("browser dismisses for a new agent message but not a previously visible one", () => {
  assert.equal(shouldCloseBrowserForAttention(opened, task("running"), snapshot("reply")), true);
  assert.equal(shouldCloseBrowserForAttention(opened, task("running"), snapshot("opening")), false);
  assert.equal(shouldCloseBrowserForAttention(opened, task("running"), snapshot("old", "2026-09-21T23:00:00.000Z")), false);
});
