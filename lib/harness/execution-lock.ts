import { AsyncLocalStorage } from 'node:async_hooks';

const ownership = new AsyncLocalStorage<() => Promise<void>>();

/** Concurrent operations can share one in-flight check, never a cached result. */
export function coalesceOwnershipCheck(check: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  return () => pending ??= Promise.resolve().then(check).finally(() => { pending = undefined; });
}

export function withExecutionOwnership<T>(assertOwned: () => Promise<void>, execute: () => Promise<T>) {
  return ownership.run(assertOwned, execute);
}

/** Fail closed before a tool starts if its worker lost the database lock. */
export async function assertExecutionOwnership() {
  await ownership.getStore()?.();
}

export class BrowserTakeoverInterrupted extends Error {
  constructor() { super("Execution interrupted by browser takeover"); this.name = "BrowserTakeoverInterrupted"; }
}
