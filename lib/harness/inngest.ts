import { opportunitySweepWorker, opportunityCheckWorker } from '../proactive/opportunity-inngest';
import { recoverRun, STALE_WORKER_MS } from "./recovery";
import { dispatchRun } from "./dispatch";
import { securityDatabase } from "../security-store";
import { morningSweepWorker, morningIdeasWorker } from "../proactive/morning-inngest";
import { proactiveEngineFunctions } from "../proactive/engine/inngest";
import { attentionNotificationBody, pendingAttentionAction } from "./attention";
import { getPauseStore } from "../pauses/store";
import { reconcileEventPauses } from "../pauses/events";
import { getScheduleStore } from "../schedules/store";
import { attachGoogleSecrets, sourceAccountIdOf } from "./google-secrets";
import { inngest } from "./inngest-client";
import { AGENT_FUNCTION_ID } from "./inngest-config";
import { agentFollowUpPlan } from "./follow-up-plan";
import { withHarnessTiming, timeHarnessOperation } from "./timing";
import type { GoogleSourceChange, processManualGoogleScan } from "../discovery/google-push-worker";
import {
  completeManualScan,
  failManualScan,
  getManualScanJobForWorker,
  markManualScanRunning,
} from "../discovery/manual-scan-jobs";
import { runAgent } from "./run";
import { preloadAgentModel } from "./preload-model";
import { getRunStore } from "./store";
import { deliverPendingPushNotifications, queueRunAttentionPushNotification, queueRunCompletionPushNotification } from "../push-notifications";

export const agentWorker = inngest.createFunction(
  { id: AGENT_FUNCTION_ID, retries: 2, checkpointing: { maxRuntime: "1s", bufferedSteps: 1 },
    concurrency: [{ limit: 1, key: "event.data.runId" }], cancelOn: [{ event: "decision-feed/run.cancelled", if: "async.data.runId == event.data.runId" }], triggers: [{ event: "decision-feed/run.requested" }] },
  async ({ event, step }) => {
    const runId = String(event.data.runId);
    let attempt = 0;
    let executed;
    while (true) {
      executed = await step.run(attempt === 0 ? "execute-agent-run" : `execute-agent-run-${attempt}`, () => withHarnessTiming("worker", runId, async () => {
        const store = getRunStore();
        if (event.data.pauseId) {
          const run = await timeHarnessOperation("worker.load_run", () => store.getRun(runId));
          if (run?.metadata.pauseDispatchId !== event.data.pauseId) return { accepted: false, pauseId: null, phoneCall: false, retryAfterMs: 0, followUps: agentFollowUpPlan(null) };
        }
        const model = preloadAgentModel(async () => {
          const { createAgentModel } = await timeHarnessOperation("worker.load_model", () => import("./model"));
          return createAgentModel(store);
        });
        const outcome = await timeHarnessOperation("worker.execute", () => runAgent({ runId, store, model }));
        const after = await store.getRun(runId);
        const pause = after?.metadata.automaticPause as { id?: string; eventKind?: string } | undefined;
        return { accepted: true, pauseId: pause?.id ?? null, phoneCall: pause?.eventKind === "phone_call", retryAfterMs: outcome?.retryAfterMs ?? 0, followUps: agentFollowUpPlan(after) };
      }));
      if (!executed.retryAfterMs) break;
      await step.sleep(`model-rate-limit-${attempt}`, `${Math.ceil(executed.retryAfterMs)}ms`);
      attempt += 1;
    }
    if (!executed.accepted) return { runId, skipped: true };
    // Older checkpointed executions have no plan: retain their existing path.
    // Each selected step still checks current state before doing any work.
    const followUps = executed.followUps;
    if (!followUps || executed.pauseId) await step.run("arm-automatic-wait", async () => {
      if (executed.pauseId) await getPauseStore().arm(runId, executed.pauseId);
    });
    if (executed.phoneCall && executed.pauseId) await step.sendEvent("monitor-phone-call", { id: `phone-monitor-${executed.pauseId}`, name: "decision-feed/phone.monitor", data: { pauseId: executed.pauseId, runId } });
    if (followUps?.attention !== false) await step.run("notify-run-needs-attention", async () => {
      const snapshot = await getRunStore().getSnapshot(runId);
      if (!snapshot || snapshot.metadata.automaticPause || (snapshot.status !== "awaiting_approval" && snapshot.status !== "paused")) return { notified: false };
      const pendingAction = pendingAttentionAction(snapshot.actions);
      if (!pendingAction) return { notified: false };
      const body = attentionNotificationBody(pendingAction);
      const queued = await queueRunAttentionPushNotification({
        ownerEmail: snapshot.userId,
        runId,
        attentionId: pendingAction.id,
        title: snapshot.title,
        body,
      });
      if (queued) await deliverPendingPushNotifications({ ownerEmail: snapshot.userId, includeRecent: true });
      return { notified: queued };
    });
    const scheduled = followUps?.scheduled !== false ? await step.run("finish-scheduled-occurrence", async () => {
      const run = await getRunStore().getRun(runId);
      if (!run?.metadata.scheduleExecution) return { scheduled: false, notified: false };
      return getScheduleStore().finish(runId);
    }) : { scheduled: false, notified: false };
    if (scheduled.notified) await step.run("deliver-scheduled-result", () => deliverPendingPushNotifications({ includeRecent: true }));
    if (!followUps || (!scheduled.scheduled && followUps.completion)) await step.run("notify-run-completed", async () => {
      if (scheduled.scheduled) return { notified: false };
      const snapshot = await getRunStore().getSnapshot(runId);
      if (!snapshot || snapshot.status !== "done" || snapshot.metadata.responseDisposition === "silent" || snapshot.metadata.responseDisposition === "reaction" || snapshot.result?.outcome === "needs_user") return { notified: false };
      const queued = await queueRunCompletionPushNotification({
        completionId: typeof snapshot.metadata.pauseDispatchId === "string" ? snapshot.metadata.pauseDispatchId : undefined,
        ownerEmail: snapshot.userId,
        runId,
        title: snapshot.title,
        body: snapshot.result?.summary?.trim() || snapshot.response?.trim() || "",
      });
      if (queued) await deliverPendingPushNotifications({ ownerEmail: snapshot.userId, includeRecent: true });
      return { notified: queued };
    });
    if (!followUps || (!scheduled.scheduled && followUps.failedWait)) await step.run("notify-wait-failed", async () => {
      const snapshot = await getRunStore().getSnapshot(runId);
      if (scheduled.scheduled || !snapshot || snapshot.status !== "failed" || typeof snapshot.metadata.pauseDispatchId !== "string") return;
      const queued = await queueRunAttentionPushNotification({ ownerEmail: snapshot.userId, runId, attentionId: `${snapshot.metadata.pauseDispatchId}:failed`, title: snapshot.title, body: snapshot.error || "I couldn’t continue this task. Open the conversation for details." });
      if (queued) await deliverPendingPushNotifications({ ownerEmail: snapshot.userId, includeRecent: true });
    });
    return { runId };
  },
);

export const googleSourceWorker = inngest.createFunction(
  {
    id: "automatic-google-source-scan",
    retries: 4,
    concurrency: [{ limit: 1, scope: "env", key: '"google-discovery:" + (has(event.data.ownerEmail) ? event.data.ownerEmail : event.data.connectionId)' }],
    triggers: [{ event: "decision-feed/google.source.changed" }],
  },
  async ({ event, step }) => {
    if (!event.data.followUpThreadId) await step.run("check-automatic-waits", () => reconcileEventPauses(String(event.data.connectionId), String(event.data.source) as "gmail" | "calendar"));
    return step.run("scan-google-source", async () => (await import("../discovery/google-push-worker")).processGoogleSourceChange({
    connectionId: String(event.data.connectionId),
    source: String(event.data.source) as GoogleSourceChange["source"],
    historyId: typeof event.data.historyId === "string" ? event.data.historyId : undefined,
    followUpThreadId: typeof event.data.followUpThreadId === "string" ? event.data.followUpThreadId : undefined,
    followUpMessageId: typeof event.data.followUpMessageId === "string" ? event.data.followUpMessageId : undefined,
  }));
  },
);

export const manualScanWorker = inngest.createFunction(
  {
    id: "durable-manual-source-scan",
    retries: 4,
    concurrency: [{ limit: 1, scope: "env", key: '"google-discovery:" + event.data.ownerEmail' }],
    cancelOn: [{ event: "decision-feed/manual.scan.cancelled", if: "async.data.jobId == event.data.jobId" }],
    triggers: [{ event: "decision-feed/manual.scan.requested" }],
    onFailure: async ({ event, error }) => {
      const original = event.data.event as { data?: { jobId?: unknown } };
      const jobId = typeof original.data?.jobId === "string" ? original.data.jobId : null;
      if (jobId) await failManualScan(jobId, error);
    },
  },
  async ({ event, step }) => {
    const jobId = String(event.data.jobId);
    const ownerEmail = String(event.data.ownerEmail);
    const job = await step.run("load-manual-scan", async () => getManualScanJobForWorker(jobId, ownerEmail));
    if (!job || (job.status !== "queued" && job.status !== "running")) return { jobId, skipped: true };
    const started = await step.run("mark-manual-scan-running", async () => markManualScanRunning(jobId));
    if (!started) return { jobId, skipped: true };
    const result = await step.run("scan-connected-sources", async () => (await import("../discovery/google-push-worker")).processManualGoogleScan({
      ownerEmail,
      forceFullScan: job.forceFullScan,
      userTimeZone: job.userTimeZone,
      deviceCalendarEvents: job.deviceCalendarEvents as Parameters<typeof processManualGoogleScan>[0]["deviceCalendarEvents"],
    }));
    await step.run("complete-manual-scan", async () => completeManualScan(jobId, result));
    return { jobId, ...result };
  },
);

export const pushNotificationWorker = inngest.createFunction(
  {
    id: "deliver-decision-push-notifications",
    retries: 2,
    triggers: [{ cron: "* * * * *" }],
  },
  async ({ step }) => step.run("deliver-pending-push-notifications", async () => deliverPendingPushNotifications()),
);

export const proactiveSweepWorker = inngest.createFunction(
  {
    id: "proactive-life-signal-sweep",
    retries: 2,
    triggers: [{ cron: "17 * * * *" }],
  },
  async ({ step }) => step.run("evaluate-calendar-weather-and-goals", async () => (await import("../discovery/google-push-worker")).processProactiveSweep()),
);


/** The database is the schedule/outbox; cron only wakes the durable dispatcher. */
export const scheduleSweepWorker = inngest.createFunction(
  { id: "dispatch-due-schedules", retries: 3, triggers: [{ cron: "* * * * *" }] },
  async ({ step }) => {
    const pending = await step.run("enqueue-due-occurrences", () => getScheduleStore().enqueueDue());
    if (pending.length) await step.sendEvent("dispatch-occurrences", pending.map(item => ({
      name: "decision-feed/schedule.due",
      // A queued occurrence blocked by a busy conversation is reconsidered next minute.
      data: { occurrenceId: String(item.id), runId: String(item.run_id) },
    })));
    return { pending: pending.length };
  },
);

export const scheduleOccurrenceWorker = inngest.createFunction(
  { id: "run-scheduled-occurrence", retries: 3, concurrency: [{ limit: 1, key: "event.data.runId" }], triggers: [{ event: "decision-feed/schedule.due" }] },
  async ({ event, step }) => {
    const occurrenceId = String(event.data.occurrenceId);
    const prepared = await step.run("prepare-occurrence", () => getScheduleStore().prepare(occurrenceId));
    if (prepared.kind === "reminder") {
      await step.run("deliver-reminder", () => deliverPendingPushNotifications({ includeRecent: true }));
    } else if (prepared.kind === "agent" && prepared.runId) {
      const runId = prepared.runId;
      await step.run("restore-connected-account", async () => {
        const store = getRunStore();
        const run = await store.getRun(runId);
        if (run) await attachGoogleSecrets(store, runId, run.userId, undefined, sourceAccountIdOf(run.metadata)).catch(() => {
          // The tool registry can request reconnection. A missing account must not strand a due occurrence.
          console.warn("[scheduled-task] Connected account unavailable", { runId });
        });
      });
      await step.sendEvent("execute-occurrence", { id: `scheduled-run-${occurrenceId}`, name: "decision-feed/run.requested", data: { runId } });
    }
    return prepared;
  },
);

/** The database outbox survives process restarts and event dispatch failures. */
export const pauseSweepWorker = inngest.createFunction(
  { id: "dispatch-automatic-waits", retries: 3, concurrency: 1, triggers: [{ cron: "* * * * *" }] },
  async ({ step }) => {
    const calls = await step.run("find-phone-calls", () => getPauseStore().phoneCalls());
    if (calls.length) await step.sendEvent("recover-phone-monitors", calls.map(pause => ({ id: `phone-monitor-${pause.id}`, name: "decision-feed/phone.monitor", data: { pauseId: pause.id, runId: pause.runId } })));
    const eventWaits = await step.run("find-event-waits", () => getPauseStore().events());
    if (eventWaits.length) await step.sendEvent("check-event-waits", eventWaits.map(pause => ({ name: "decision-feed/pause.check", data: { pauseId: pause.id } })));
    const pending = await step.run("find-ready-waits", () => getPauseStore().sweep());
    if (pending.length) await step.sendEvent("dispatch-ready-waits", pending.map(pause => ({ name: "decision-feed/pause.ready", data: { pauseId: String(pause.id), runId: String(pause.run_id) } })));
    return { pending: pending.length };
  },
);
export const pauseResumeWorker = inngest.createFunction(
  { id: "resume-automatic-wait", retries: 4, concurrency: [{ limit: 1, key: "event.data.runId" }], triggers: [{ event: "decision-feed/pause.ready" }] },
  async ({ event, step }) => {
    const pauseId = String(event.data.pauseId);
    const runId = await step.run("claim-continuation", () => getPauseStore().prepare(pauseId));
    if (!runId) return { skipped: true };
    await step.run("restore-wait-account", async () => {
      const store = getRunStore();
      const run = await store.getRun(runId);
      if (run) await attachGoogleSecrets(store, runId, run.userId, undefined, sourceAccountIdOf(run.metadata)).catch(() => {
        console.warn("[automatic-wait] Connected account unavailable", { runId });
      });
    });
    await step.sendEvent("continue-conversation", { id: `pause-run-${pauseId}`, name: "decision-feed/run.requested", data: { runId, pauseId } });
    return { runId };
  },
);

export const pauseEventWorker = inngest.createFunction(
  { id: "check-automatic-wait-event", retries: 3, concurrency: [{ limit: 1, key: "event.data.pauseId" }], triggers: [{ event: "decision-feed/pause.check" }] },
  async ({ event, step }) => step.run("check-wait-source", () => reconcileEventPauses(undefined, undefined, String(event.data.pauseId))),
);

export const phoneMonitorWorker = inngest.createFunction(
  { id: "monitor-phone-call", retries: 3,
    onFailure: async ({ event }) => {
      const original = event.data.event as { data?: { pauseId?: string } };
      if (original.data?.pauseId) await getPauseStore().markReady(original.data.pauseId, { kind: "phone_monitor_failed", message: "Call monitoring stopped unexpectedly. Check the same call with phone_call_result. Do not claim completion or redial." });
    }, concurrency: [{ limit: 1, key: "event.data.pauseId" }], cancelOn: [{ event: "decision-feed/run.cancelled", if: "async.data.runId == event.data.runId" }], triggers: [{ event: "decision-feed/phone.monitor" }] },
  async ({ event, step }) => {
    const pauseId = String(event.data.pauseId);
    // Preserve the roughly 75-minute monitoring window without provider long-polling.
    for (let index = 0; index < 300; index++) {
      const result = await step.run(`check-call-${index}`, async () => (await import("./phone-monitor")).checkPhoneCall(pauseId));
      if (result.state === "inactive") return { stopped: true };
      if (result.state === "ready") {
        await step.sendEvent("continue-after-call", { name: "decision-feed/pause.ready", data: { pauseId, runId: result.runId } });
        return { completed: true };
      }
      await step.sleep(`next-check-${index}`, "15s");
    }
    await step.run("report-monitor-timeout", () => getPauseStore().markReady(pauseId, { kind: "phone_monitor_failed", message: "The phone call remained pending beyond the monitoring limit. Do not claim success or redial; report this and inspect the same call." }));
    await step.sendEvent("continue-after-monitor-timeout", { name: "decision-feed/pause.ready", data: { pauseId, runId: String(event.data.runId) } });
    return { timedOut: true };
  },
);

/** Hard kills cannot execute finally/onFailure inside the dead invocation. */
export const abandonedAgentWorker = inngest.createFunction(
  { id: "recover-abandoned-agent-runs", retries: 2, concurrency: 1, triggers: [{ cron: "* * * * *" }] },
  async ({ step }) => {
    const ids = await step.run("find-abandoned", async () => {
      const db = securityDatabase();
      if (!db) return [] as string[];
      const rows = await db`select id from agent_runs where status in ('planning','running')
        and coalesce((metadata->>'workerHeartbeatAt')::bigint, (extract(epoch from updated_at)*1000)::bigint) < ${Date.now()-STALE_WORKER_MS}
        and coalesce((metadata->>'workerRecoveryAt')::bigint,0) < ${Date.now()-STALE_WORKER_MS}
        order by updated_at limit 50`;
      return rows.map(row => String(row.id));
    });
    for (const id of ids) await step.run(`recover-${id}`, () => recoverRun(getRunStore(), id, dispatchRun));
    return { checked: ids.length };
  },
);

export const icloudScanWorker = inngest.createFunction({
  id: "scan-icloud-mail", retries: 3,
  concurrency: [{ limit: 1, scope: "env", key: '"google-discovery:" + event.data.ownerEmail' }],
  triggers: [{ event: "decision-feed/icloud.scan.requested" }],
}, async ({ event, step }) => step.run("read-and-discover-icloud-mail", async () =>
  (await import("../mail/icloud-scan")).scanICloudAccount(String(event.data.ownerEmail), String(event.data.accountId))));
export const icloudSweepWorker = inngest.createFunction({
  id: "check-connected-icloud-mail", retries: 2, triggers: [{ cron: "*/15 * * * *" }],
}, async ({ step }) => {
  const accounts = await step.run("due-icloud-accounts", async () => (await import("../mail/icloud-scan")).dueICloudAccounts());
  if (accounts.length) await step.sendEvent("queue-icloud-checks", accounts.map(account => ({ name: "decision-feed/icloud.scan.requested", data: account })));
  return { accounts: accounts.length };
});

export const inngestFunctions = [opportunitySweepWorker, opportunityCheckWorker, icloudScanWorker, icloudSweepWorker, abandonedAgentWorker,...proactiveEngineFunctions, morningSweepWorker, morningIdeasWorker, phoneMonitorWorker, pauseEventWorker, pauseSweepWorker, pauseResumeWorker, agentWorker, googleSourceWorker, manualScanWorker, pushNotificationWorker, proactiveSweepWorker, scheduleSweepWorker, scheduleOccurrenceWorker];
