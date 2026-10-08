import type { AgentModel } from "./types";

/** Overlap module loading with the worker's lock and capacity checks. */
export function preloadAgentModel(load: () => Promise<AgentModel>): AgentModel {
  const model = load();
  // A rejected import may arrive before the worker has acquired its lock.
  // Observe it immediately; awaiting turn/dispose still reports the failure.
  void model.catch(() => undefined);
  return {
    prepare(run) { void model.then(value => value.prepare?.(run)).catch(() => undefined); },
    async turn(input) { await (await model).turn(input); },
    async dispose() { await (await model).dispose?.(); },
  };
}
