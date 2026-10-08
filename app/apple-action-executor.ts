/** Share one native request across the app runner and conversation controls. */
export function createAppleActionExecutor<T>() {
  const attempts = new Map<string, { promise: Promise<T>; failed: boolean; settled: boolean }>();
  return {
    execute(key: string, start: () => Promise<T>, retry = false): Promise<T> {
      const prior = attempts.get(key);
      if (prior && !(retry && prior.failed)) return prior.promise;
      const entry = { promise: Promise.resolve().then(start), failed: false, settled: false };
      entry.promise = entry.promise.then(value => { entry.settled = true; return value; }, error => { entry.settled = true; entry.failed = true; throw error; });
      attempts.set(key, entry);
      return entry.promise;
    },
    retain(keys: Set<string>) {
      // Server completion can reach the task list before the native reply. Keep
      // its in-flight promise across removal/remount so a late snapshot cannot
      // start a second native request and surface an "already running" card.
      for (const [key, attempt] of attempts) if (!keys.has(key) && attempt.settled) attempts.delete(key);
    },
  };
}
export function appleActionKey(task: { runId?: string; actionId?: string }) {
  return `${task.runId}:${task.actionId}`;
}
