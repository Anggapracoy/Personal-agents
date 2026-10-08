export type CleanupControl = { signal: AbortSignal; assertOwned: () => Promise<void> };

/** Check immediately before each external mutation, and after intervening awaits. */
export async function assertCleanupActive(control?: CleanupControl) {
  if (!control) return;
  control.signal.throwIfAborted();
  await control.assertOwned();
  control.signal.throwIfAborted();
}
