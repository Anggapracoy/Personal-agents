import assert from "node:assert/strict";
import test from "node:test";
import { agentFollowUpPlan } from "../lib/harness/follow-up-plan";
import { agentWorker } from "../lib/harness/inngest";
import { getRunStore } from "../lib/harness/store";
import type { AgentRun } from "../lib/harness/types";

type State = Pick<AgentRun, "status" | "metadata" | "result">;
const state = (status: State["status"], metadata: State["metadata"] = {}): State => ({ status, metadata, result: null });
const checkpoint = (run: State) => ({
  accepted: true, pauseId: (run.metadata.automaticPause as { id?: string } | undefined)?.id ?? null,
  phoneCall: (run.metadata.automaticPause as { eventKind?: string } | undefined)?.eventKind === "phone_call",
  retryAfterMs: 0, followUps: agentFollowUpPlan(run),
});

async function runWorker(saved: unknown, options: { runId?: string; results?: Record<string, unknown>; execute?: boolean } = {}) {
  const steps: string[] = [], events: unknown[] = [];
  const values: Record<string, unknown> = {};
  const handler = (agentWorker as unknown as { fn: (input: unknown) => Promise<unknown> }).fn;
  await handler({ event: { data: { runId: options.runId ?? "test-run" } }, step: {
    run: async (name: string, work: () => Promise<unknown>) => {
      steps.push(name);
      if (name === "execute-agent-run") return saved;
      const value = options.execute ? await work() : options.results?.[name] ?? { notified: false };
      values[name] = value;
      return value;
    },
    sendEvent: async (name: string, event: unknown) => { steps.push(name); events.push(event); },
    sleep: async () => assert.fail("Unexpected retry"),
  } });
  return { steps: steps.slice(1), events, values };
}

test("ordinary completed reply schedules only its completion notification", async () => {
  assert.deepEqual((await runWorker(checkpoint(state("done")))).steps, ["notify-run-completed"]);
});

test("silent, reaction, active, cancelled and ordinary failed runs have no follow-up steps", async () => {
  for (const run of [state("done", { responseDisposition: "silent" }), state("done", { responseDisposition: "reaction" }), state("running"), state("planning"), state("cancelled"), state("failed")]) {
    assert.deepEqual((await runWorker(checkpoint(run))).steps, []);
  }
  assert.deepEqual(agentFollowUpPlan(null), { attention: false, scheduled: false, completion: false, failedWait: false });
});

test("approvals and questions retain their attention step", async () => {
  for (const status of ["awaiting_approval", "paused"] as const) {
    assert.deepEqual((await runWorker(checkpoint(state(status)))).steps, ["notify-run-needs-attention"]);
  }
});

test("automatic waits arm before phone monitoring and do not notify as manual pauses", async () => {
  for (const eventKind of ["gmail_reply", "phone_call"]) {
    const result = await runWorker(checkpoint(state("paused", { automaticPause: { id: "pause-id", eventKind } })));
    assert.deepEqual(result.steps, eventKind === "phone_call" ? ["arm-automatic-wait", "monitor-phone-call"] : ["arm-automatic-wait"]);
    if (eventKind === "phone_call") assert.deepEqual(result.events, [{ id: "phone-monitor-pause-id", name: "decision-feed/phone.monitor", data: { pauseId: "pause-id", runId: "test-run" } }]);
  }
});

test("failed automatic continuation retains failure notification", async () => {
  assert.deepEqual((await runWorker(checkpoint(state("failed", { pauseDispatchId: "pause-id" })))).steps, ["notify-wait-failed"]);
});

test("scheduled completion finalizes and delivers only when the schedule requests notification", async () => {
  for (const notified of [false, true]) {
    const result = await runWorker(checkpoint(state("done", { scheduleExecution: { occurrenceId: "occurrence" } })), {
      results: { "finish-scheduled-occurrence": { scheduled: true, notified } },
    });
    assert.deepEqual(result.steps, notified ? ["finish-scheduled-occurrence", "deliver-scheduled-result"] : ["finish-scheduled-occurrence"]);
  }
});

test("scheduled pauses and failures preserve finalization without duplicate notifications", async () => {
  const metadata = { scheduleExecution: { occurrenceId: "occurrence" }, pauseDispatchId: "pause-id" };
  const results = { "finish-scheduled-occurrence": { scheduled: true, notified: false } };
  assert.deepEqual((await runWorker(checkpoint(state("paused", metadata)), { results })).steps, ["notify-run-needs-attention", "finish-scheduled-occurrence"]);
  assert.deepEqual((await runWorker(checkpoint(state("failed", metadata)), { results })).steps, ["finish-scheduled-occurrence"]);
});

test("if the scheduled occurrence is gone, ordinary completion still follows its saved plan", async () => {
  const result = await runWorker(checkpoint(state("done", { scheduleExecution: {} })), {
    results: { "finish-scheduled-occurrence": { scheduled: false, notified: false } },
  });
  assert.deepEqual(result.steps, ["finish-scheduled-occurrence", "notify-run-completed"]);
});

test("checkpoints from the previous version retain all original step IDs", async () => {
  const { followUps: _plan, ...legacy } = checkpoint(state("done"));
  const result = await runWorker(legacy, { results: { "finish-scheduled-occurrence": { scheduled: true, notified: true } } });
  assert.deepEqual(result.steps, ["arm-automatic-wait", "notify-run-needs-attention", "finish-scheduled-occurrence", "deliver-scheduled-result", "notify-run-completed", "notify-wait-failed"]);
});

test("stale pause dispatch exits without any follow-up", async () => {
  assert.deepEqual((await runWorker({ ...checkpoint(state("paused")), accepted: false })).steps, []);
});

test("a newer reply suppresses completion and failure notifications during replay", async () => {
  const store = getRunStore();
  const run = await store.createRun({ userId: "follow-up-test", decisionId: null, category: "test", request: "test", title: "test", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  for (const oldState of [state("done"), state("failed", { pauseDispatchId: "old-pause" }), state("awaiting_approval")]) {
    const result = await runWorker(checkpoint(oldState), { runId: run.id, execute: true });
    assert.equal(result.steps.length, 1);
    assert.equal((await store.getRun(run.id))?.status, "running");
    assert.deepEqual(result.events, []);
  }
});

test("old checkpoints can execute their now-irrelevant steps harmlessly", async () => {
  const store = getRunStore();
  const run = await store.createRun({ userId: "follow-up-test", decisionId: null, category: "test", request: "test", title: "test", metadata: { responseDisposition: "silent" } });
  await store.updateRun(run.id, { status: "done" });
  const { followUps: _plan, ...legacy } = checkpoint(state("done"));
  assert.equal((await runWorker(legacy, { runId: run.id, execute: true })).steps.length, 5);
});
