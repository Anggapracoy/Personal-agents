import { after } from "next/server";
import { getRunStore } from "./store";
import { withHarnessTiming, timeHarnessOperation } from "./timing";
import { RunStoppedError } from "./actions";
import type { RunStore } from "./types";

const loadWorker = () => Promise.all([import("./model"), import("./run")]);

/** Start only AFTER durable dispatch succeeds. The database execution lock
 * arbitrates with the Inngest worker, which still performs recovery/follow-ups. */
export function prepareInteractiveStart(dependencies: {
  load?: () => Promise<[Pick<typeof import("./model"), "createAgentModel">, Pick<typeof import("./run"), "runAgent">]>;
  store?: () => RunStore;
  keepAlive?: (work: () => Promise<void>) => void;
  enabled?: boolean;
} = {}) {
  const enabled = dependencies.enabled ?? Boolean(process.env.DATABASE_URL && process.env.INNGEST_EVENT_KEY && process.env.INTERACTIVE_LOCAL_START !== "0");
  if (!enabled) return (_runId: string) => {};
  const base = (dependencies.store ?? getRunStore)();
  // Best effort only: normal queries still connect/reconnect when needed.
  void timeHarnessOperation("worker.connections", async () => base.prepareConnections?.()).catch(() => undefined);
  const worker = timeHarnessOperation("worker.preload", dependencies.load ?? loadWorker);
  void worker.catch(() => undefined);
  return (runId: string) => {
    // Register lifetime management before beginning any execution.
    let execute!: () => void;
    const gate = new Promise<void>(resolve => { execute = resolve; });
    const completion = gate.then(async () => {
      const [{ createAgentModel }, { runAgent }] = await worker;
      const controller = new AbortController();
      const checkCancellation = async () => {
        const run = await base.getRun(runId);
        if (!run || run.status === "cancelled") {
          controller.abort(new RunStoppedError());
          throw new RunStoppedError();
        }
      };
      // Local execution does not receive Inngest's cancelOn signal. Poll only
      // during the local attempt, and check again before publishing a message.
      const monitor = setInterval(() => { void checkCancellation().catch(error => controller.abort(error)); }, 1000);
      const store = new Proxy(base, { get(target, key) {
        const method = Reflect.get(target, key);
        if (typeof method !== "function") return method;
        return async (...args: unknown[]) => {
          if (args[0] === runId && (key === "appendMessages" || key === "updateRun")) await checkCancellation();
          return method.apply(target, args);
        };
      } });
      try {
        await withHarnessTiming("interactive_worker", runId, () => runAgent({ runId, store, model: createAgentModel(store), signal: controller.signal }));
      } finally { clearInterval(monitor); }
    }).catch(() => {
      // The durable invocation is already admitted and will retry/recover.
      console.warn("[agent-dispatch] Local start ended; durable worker owns recovery", { runId });
    });
    try { (dependencies.keepAlive ?? after)(() => completion); }
    catch {
      console.warn("[agent-dispatch] Local start unavailable; using durable worker", { runId });
      return;
    }
    execute();
  };
}
