/** Persist the first text immediately, then coalesce deltas without losing the final chunk. */
export function createBatchedNarration(write: (delta: string) => Promise<void>, intervalMs = 100) {
  let pending = "";
  let lastWriteAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | undefined;
  let failure: { error: unknown } | undefined;
  let closed = false;

  function clearTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }

  async function flush(): Promise<void> {
    clearTimer();
    while (writing) await writing;
    if (failure) throw failure.error;
    if (!pending) return;
    const delta = pending;
    pending = "";
    lastWriteAt = Date.now();
    // Assign the promise before invoking write so concurrent flushes serialize.
    const operation = Promise.resolve().then(() => write(delta));
    writing = operation;
    try { await operation; }
    catch (error) { failure = { error }; throw error; }
    finally { if (writing === operation) writing = undefined; }
    if (pending) await flush();
  }

  return {
    async append(delta: string) {
      if (closed) throw new Error("Narration is already closed.");
      if (failure) throw failure.error;
      pending += delta;
      if (lastWriteAt === undefined || (!writing && Date.now() - lastWriteAt >= intervalMs)) return flush();
      if (timer === undefined) {
        timer = setTimeout(() => { timer = undefined; void flush().catch(error => { failure = { error }; }); }, Math.max(0, intervalMs - (Date.now() - lastWriteAt)));
        timer.unref?.();
      }
    },
    flush,
    async close() { closed = true; await flush(); },
  };
}
