import { AsyncLocalStorage } from "node:async_hooks";
import type { LanguageModelMiddleware } from "ai";
import type { RunStore } from "./types";

type Span = { name: string; startMs: number; durationMs: number; failed?: boolean };
type Trace = { phase: string; startedAt: string; started: number; spans: Span[]; dropped: number };
const traces = new AsyncLocalStorage<Trace>();
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Opt-in local timing: operation names and durations only, never arguments, messages or secrets. */
export async function withHarnessTiming<T>(phase: string, runId: string | (() => string | undefined), operation: () => Promise<T>): Promise<T> {
  if (process.env.HARNESS_TIMING !== "1") return operation();
  const trace: Trace = { phase, startedAt: new Date().toISOString(), started: performance.now(), spans: [], dropped: 0 };
  return traces.run(trace, async () => {
    let failed = false;
    try { return await operation(); }
    catch (error) { failed = true; throw error; }
    finally {
      const resolvedRunId = typeof runId === "function" ? runId() : runId;
      const data = { phase, failed, at: Date.parse(trace.startedAt), runId: resolvedRunId, startedAt: trace.startedAt, durationMs: round(performance.now() - trace.started), spans: trace.spans.sort((a, b) => a.startMs - b.startMs), dropped: trace.dropped };

      if (process.env.HARNESS_TIMING === "1") console.info("[harness-timing]", JSON.stringify(data));
    }
  });
}

export function startHarnessOperation(name: string) {
  const trace = traces.getStore();
  const started = performance.now();
  let finished = false;
  return (failed = false) => {
    if (!trace || finished) return;
    finished = true;
    if (trace.spans.length >= 2000) { trace.dropped++; return; }
    trace.spans.push({ name, startMs: round(started - trace.started), durationMs: round(performance.now() - started), ...(failed ? { failed: true } : {}) });
  };
}

export async function timeHarnessOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (!traces.getStore()) return operation();
  const finish = startHarnessOperation(name);
  try { const value = await operation(); finish(); return value; }
  catch (error) { finish(true); throw error; }
}

export function timedRunStore(store: RunStore): RunStore {
  return new Proxy(store, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => timeHarnessOperation(`store.${String(key)}`, () => value.apply(target, args));
    },
  });
}

export const harnessTimingMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",
  wrapStream: async ({ doStream }) => {
    if (!traces.getStore()) return doStream();
    const finish = startHarnessOperation("model.request");
    try {
      const result = await timeHarnessOperation("model.headers", async () => doStream());
      let firstText = false;
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        transform(part, controller) {
          if (part.type === "text-delta" && !firstText) {
            firstText = true;
            startHarnessOperation("model.first_text")();
          }
          if (part.type === "finish" || part.type === "error") finish(part.type === "error");
          controller.enqueue(part);
        },
        flush() { finish(); },
      })) };
    } catch (error) { finish(true); throw error; }
  },
};
