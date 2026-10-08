import { AsyncLocalStorage } from 'node:async_hooks';

type Frame = { id: string; name: string; mimeType: string } | null;
type PendingFrame = { snapshot: string; url: string; capture: () => Promise<Frame> };
const batches = new AsyncLocalStorage<{ pending?: PendingFrame }>();
const backgroundFrames = new AsyncLocalStorage<Set<Promise<unknown>>>();

/** Viewer-only captures may overlap model inference, but stay inside the run's
 * execution lease. The provider queues capture before any subsequent action;
 * explicit model screenshots never enter this path. */
export async function withBackgroundBrowserFrames<T>(work: () => Promise<T>): Promise<T> {
  return backgroundFrames.run(new Set(), async () => {
    try { return await work(); }
    finally { await Promise.allSettled([...backgroundFrames.getStore()!]); }
  });
}
function captureFrame(pending: PendingFrame): Promise<Frame> {
  const tasks = backgroundFrames.getStore();
  if (!tasks) return pending.capture();
  // Start now, before handing control back to the model. Do not defer capture
  // until after another action or a task/worker handoff.
  const task = pending.capture().catch(() => null);
  tasks.add(task);
  void task.finally(() => tasks.delete(task));
  return Promise.resolve(null);
}

/** Keep observations and input synchronous. Only coalesce automatic viewer PNGs;
 * explicitly requested screenshots still run at their exact script position. */
export async function browserFrameForResult(pending: PendingFrame): Promise<Frame> {
  const batch = batches.getStore();
  if (!batch) return captureFrame(pending);
  batch.pending = pending;
  return null;
}

export async function withBrowserFrameBatch(work: () => Promise<Record<string, unknown>>) {
  return batches.run({}, async () => {
    const result = await work();
    const pending = batches.getStore()?.pending;
    if (pending && !result.$toolError && result.lastBrowserAction !== 'browser_screenshot'
        && result.snapshot === pending.snapshot && result.url === pending.url) {
      result.browserFrame = await captureFrame(pending);
    }
    return result;
  });
}
