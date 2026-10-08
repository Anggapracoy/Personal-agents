import { assertExecutionOwnership } from '../execution-lock';

/** Prepare transport while the model finishes a declared browser tool's args.
 * Never navigate, create Chrome, or change the tool call. Ordinary execution
 * remains responsible for surfacing preparation failures and retrying setup.
 */
export function createBrowserPreparation(prepare: () => Promise<void>, signal?: AbortSignal) {
  let pending: Promise<void> | undefined;
  return (part: { type: string; toolName?: string }) => {
    if (signal?.aborted || part.type !== 'tool-input-start' || !['browser_run', 'browser_open'].includes(part.toolName ?? '')) return;
    return pending ??= Promise.resolve().then(async () => {
      await assertExecutionOwnership();
      if (!signal?.aborted) await prepare();
    }).catch(() => undefined);
  };
}
