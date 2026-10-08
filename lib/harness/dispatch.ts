import { getRunStore } from "./store";
import { inngest } from "./inngest-client";
import { dispatchInteractiveAgent } from "./fast-invoke";
import { timeHarnessOperation } from "./timing";

declare global { var __decisionFeedLocalRuns: Map<string, Promise<void>> | undefined; }
const localRuns = globalThis.__decisionFeedLocalRuns ??= new Map<string, Promise<void>>();

/** Human input takes the direct path; cron, webhooks and recovery keep events. */
export async function dispatchInteractiveRun(runId: string, eventId?: string) {
  if (!process.env.INNGEST_EVENT_KEY || !process.env.DATABASE_URL) { await dispatchRun(runId, eventId); return false; }
  // The SDK infers VERCEL_GIT_COMMIT_REF even for production deployments.
  // That inferred branch does not override the production signing key's scope.
  const productionBranch = process.env.VERCEL_ENV === "production" && !process.env.INNGEST_ENV
    && !process.env.BRANCH_NAME && inngest.env === process.env.VERCEL_GIT_COMMIT_REF;
  return timeHarnessOperation("inngest.invoke", () => dispatchInteractiveAgent(runId, eventId, {
    signingKey: inngest.signingKey,
    enabled: process.env.INNGEST_FAST_INVOKE !== "0" && inngest.mode === "cloud"
      && (!inngest.env || productionBranch) && new URL(inngest.apiBaseUrl).origin === "https://api.inngest.com",
    sendEvent: () => dispatchRun(runId, eventId),
    onUncertain: () => console.warn("[agent-dispatch] Invoke receipt unavailable; preserving active run for recovery", { runId }),
  }));
}

export async function dispatchRun(runId: string, eventId?: string) {
  if (process.env.INNGEST_EVENT_KEY && process.env.DATABASE_URL) {
    await inngest.send({ ...(eventId ? { id: eventId } : {}), name: "decision-feed/run.requested", data: { runId } });
    return;
  }
  const [{ createAgentModel }, { runAgent }] = await Promise.all([import("./model"), import("./run")]);
  const existing = localRuns.get(runId);
  if (existing) await existing;
  const store = getRunStore();
  const promise = (async () => {
    while (true) {
      const outcome = await runAgent({ runId, store, model: createAgentModel(store) });
      if (!outcome?.retryAfterMs) return;
      await new Promise(resolve => setTimeout(resolve, outcome.retryAfterMs));
    }
  })().finally(() => localRuns.delete(runId));
  localRuns.set(runId, promise);
}
