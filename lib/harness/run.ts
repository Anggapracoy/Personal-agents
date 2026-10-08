
import { withBackgroundBrowserFrames } from "./browser/frame-batch";
import { executionSliceDue, ExecutionSliceYield, withExecutionSlice } from "./execution-slice";
import { acquireUserCapacity } from "./user-capacity";
import { BrowserTakeoverInterrupted, coalesceOwnershipCheck, withExecutionOwnership } from "./execution-lock";
import { providerBillingFailure, providerErrorMessage } from "./provider-error";
import { rateLimitDelay } from "./rate-limit";
import { isTemporaryMetaModelNotFound } from "./model-not-found";
import { withHarnessTiming } from "./timing";
import { isApprovalRequired, RunStoppedError } from "./actions";
import { isQuestionsRequired } from "./questions";
import { hasUnreadRuntimeResult } from "./runtime-message";
import { pendingSteering } from "./steering";
import type { AgentModel, AgentResult, AgentRun, RunStore } from "./types";

const TERMINAL = new Set(["done", "failed", "cancelled"]);
const WAITING = new Set(["awaiting_approval", "paused"]);

/**
 * The agent loop. One run is one thread; every dispatch is one turn over the
 * whole thread. The model calls tools until it either answers in plain text
 * (thread goes idle as `done`) or a pause tool suspends the run for the user
 * (`awaiting_approval` / `paused`). Approvals, answers, sign-ins and follow-up
 * messages append to the same thread and re-dispatch; nothing is re-planned.
 */
export async function runAgent(input: { runId: string; store: RunStore; model: AgentModel; signal?: AbortSignal; sliceMs?: number }) {
  const controller = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  let entered = false;
  let takeoverInterrupted = false;
  const interrupt = (error: unknown) => {
    if (error instanceof BrowserTakeoverInterrupted) takeoverInterrupted = true;
    controller.abort(error);
  };
  try {
    const locked = await input.store.withExecutionLock(input.runId, async (assertOwned, lockedRun) => {
      const run = lockedRun === undefined ? await input.store.getRun(input.runId) : lockedRun;
      if (!run || TERMINAL.has(run.status) || WAITING.has(run.status)) {
        if (run && TERMINAL.has(run.status)) await input.store.deleteSecrets(input.runId);
        return;
      }
      input.model.prepare?.(run);
      const capacityPromise = acquireUserCapacity(run.userId);
      // The heartbeat marks this worker attempt; capacity still gates execution.
      // Release an acquired slot if the parallel heartbeat write fails.
      const [capacity, initialRun] = await Promise.all([
        capacityPromise,
        input.store.updateRunMetadata(input.runId, { workerHeartbeatAt: Date.now() }),
      ]).catch(async error => {
        await capacityPromise.then(slot => slot?.release(), () => undefined);
        throw error;
      });
      if (!capacity) return { retryAfterMs: 15_000 };
      entered = true;
      let lastHeartbeat = Date.now();
      const check = coalesceOwnershipCheck(async () => {
        signal.throwIfAborted();
        try { await assertOwned(); await capacity.assertOwned();
          if (Date.now() - lastHeartbeat >= 20_000) { lastHeartbeat = Date.now(); await input.store.updateRunMetadata(input.runId, { workerHeartbeatAt: lastHeartbeat }); }
        }
        catch (error) { interrupt(error); throw error; }
      });
      // Stop provider generation even when it is reasoning and not calling tools.
      // The epoch remains changed after Continue, fencing the old worker too.
      const takeoverWatcher = setInterval(() => { void assertOwned().catch(error => interrupt(error)); }, 1000);
      const heartbeat = setInterval(() => { void check().catch(() => undefined); }, 20_000);
      const store = new Proxy(input.store, { get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          try { await check(); }
          catch (error) {
            // A dispatched action must still record its outcome after takeover;
            // only its audit result may settle, never new model work or narration.
            if (key !== "completeAction" || !(controller.signal.reason instanceof BrowserTakeoverInterrupted)) throw error;
          }
          return value.apply(target, args);
        };
      } });
      try {
        return await withExecutionSlice(Date.now() + (input.sliceMs ?? 180_000), () => withExecutionOwnership(check, () => withBackgroundBrowserFrames(() => withHarnessTiming("agent", input.runId, () => executeAgent({ ...input, store, signal, initialRun })))));
      } finally { clearInterval(takeoverWatcher); clearInterval(heartbeat); controller.abort(); await capacity.release(); }
    }, { loadRun: true });
    return locked.acquired ? locked.value : { retryAfterMs: 5_000 };
  } catch (error) {
    if (!takeoverInterrupted) throw error;
  } finally {
    controller.abort();
    if (!entered) await input.model.dispose?.();
  }
}

/** User steering takes over an automatic occurrence before the next model turn. */
export async function consumeUserSteering(store: RunStore, runId: string, abandonSchedule?: (runId: string) => Promise<unknown>, requireHistory = false) {
  if (!await store.consumeSteering(runId, requireHistory)) return false;
  if ((await store.getRun(runId))?.metadata.scheduleExecution) {
    const abandon = abandonSchedule ?? (async (id: string) => (await import("../schedules/store")).getScheduleStore().abandonForUserReply(id));
    await abandon(runId);
  }
  return true;
}

async function executeAgent(input: { runId: string; store: RunStore; model: AgentModel; signal?: AbortSignal; initialRun: AgentRun | null }) {
  const { runId, store, model, signal } = input;
  let initialRun = input.initialRun;
  try {
    while (!signal?.aborted) {
      if (executionSliceDue()) return { retryAfterMs: 1 };
      // The heartbeat write already returned current state, including cancellation
      // and queued input. Later loop iterations fetch fresh state as usual.
      let run = initialRun ?? await store.getRun(runId);
      initialRun = null;
      if (pendingSteering(run).length) {
        // A first turn must seed its original request before consuming queued replies.
        if (await consumeUserSteering(store, runId, undefined, true)) run = await store.getRun(runId);
      }
      if (!run || TERMINAL.has(run.status) || WAITING.has(run.status)) return;
      const cooldown = Number(run.metadata.modelRetryAt ?? 0) - Date.now();
      if (cooldown > 0) return { retryAfterMs: cooldown };
      if (run.metadata.modelRetryAt) await store.updateRunMetadata(runId, { modelRetryAt: null });
      if (hasUnreadRuntimeResult(run)) {
        const messages = await store.listMessages(runId);
        await store.acknowledgeRuntimeResults(runId, Math.max(0, ...messages.map(message => message.seq)));
      }
      if (run.status !== "running") await store.updateRun(runId, { status: "running", error: null });
      const turnId = crypto.randomUUID();
      let response = "";
      try {
        await model.turn({
          run: { ...run, status: "running" },
          turnId,
          signal,
          onNarration: async (delta) => {
            response += delta;
            await store.updateRun(runId, { response });
          },
        });
      } catch (error) {
        if (error instanceof ExecutionSliceYield) return { retryAfterMs: 1 };
        const billing = providerBillingFailure(error);
        if (billing && !signal?.aborted) {
          const current = await store.getRun(runId);
          if (!current || TERMINAL.has(current.status) || WAITING.has(current.status)) return;
          if (!current.metadata.providerFallback) {
            await store.updateRunMetadata(runId, {
              providerFailure: billing, providerFallback: "terra-medium", modelRetryAt: null,
              modelProvider: "openai", modelId: "gpt-5.6-terra", reasoningEffort: "medium",
            });
            continue;
          }
          await store.updateRunMetadata(runId, { providerFailure: billing, modelRetryAt: null, replyTyping: false });
          if (await store.finishRunIfNoSteering(runId, null, `The AI provider interrupted this task with ${billing.code} (HTTP ${billing.status}). Progress was saved. The provider's billing or configuration needs to be checked before retrying.`)) return;
          continue;
        }
        const missingModel = isTemporaryMetaModelNotFound(error);
        const missingModelAttempts = Number(run.metadata.modelNotFoundRetries ?? 0);
        const retryAfterMs = missingModel && missingModelAttempts < 3 ? 1_000 : rateLimitDelay(error);
        if (retryAfterMs !== null && !signal?.aborted) {
          const current = await store.getRun(runId);
          if (!current || TERMINAL.has(current.status) || WAITING.has(current.status)) return;
          await store.updateRunMetadata(runId, { modelRetryAt: Date.now() + retryAfterMs, replyTyping: false,
            ...(missingModel ? { modelNotFoundRetries: missingModelAttempts + 1 } : {}) });
          return { retryAfterMs };
        }
        if (!signal?.aborted && await consumeUserSteering(store, runId)) continue;
        const current = await store.getRun(runId);
        if (!signal?.aborted && current?.status === "running" && hasUnreadRuntimeResult(current)) continue;
        if (isApprovalRequired(error) || isQuestionsRequired(error) || error instanceof RunStoppedError || signal?.aborted) return;
        const message = providerErrorMessage(error);
        if (await store.finishRunIfNoSteering(runId, null, message)) return;
        continue;
      }
      if (run.metadata.modelNotFoundRetries) await store.updateRunMetadata(runId, { modelNotFoundRetries: 0 });
      if (await consumeUserSteering(store, runId)) continue;
      // Pause tools flip the durable status inside the turn; never overwrite that.
      const snapshot = await store.getSnapshot(runId);
      if (!snapshot || WAITING.has(snapshot.status) || TERMINAL.has(snapshot.status) || signal?.aborted) return;
      // Native work can complete before the other tools in this turn settle.
      // Reload its durable receipt in a fresh model turn rather than ending on stale history.
      if (hasUnreadRuntimeResult(snapshot)) continue;
      const priorWaiting = snapshot.metadata.reactionResumeStatus;
      if ((priorWaiting === "paused" || priorWaiting === "awaiting_approval") && snapshot.actions.some(action => action.status === "proposed")) {
        if (await store.restoreWaitingIfNoSteering(runId, priorWaiting)) return;
        continue;
      }
      const noReply = snapshot.metadata.responseDisposition === "silent" || snapshot.metadata.responseDisposition === "reaction";
      // Plain prose carries no structured claim of verified work or external changes.
      // Historical tool executions cannot establish the outcome of this turn.
      const result: AgentResult | null = noReply ? null : snapshot.result ?? {
        outcome: "no_action",
        summary: (snapshot.response.trim() || "Done.").slice(0, 500),
        details: snapshot.response.trim().slice(0, 5_000) || "Done.",
        verified: false,
        externalChange: false,
        options: [], followUpActions: [], facts: [], links: [], moneySaved: null, recommendedNextStep: null,
      };
      if (await store.finishRunIfNoSteering(runId, result)) return;
      // Enqueue and finish share the same row lock: input arriving during finalization wins.
    }

  } finally {
    await model.dispose?.();
    const finalRun = await store.getRun(runId);
    if (finalRun && TERMINAL.has(finalRun.status)) await store.deleteSecrets(runId);
  }
}
