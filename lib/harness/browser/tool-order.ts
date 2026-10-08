import type { ToolSet } from "ai";

/** Queue the whole browser tool, including preflight, mutation and observation.
 * The controller's operation lock alone cannot preserve order across those steps.
 * Wrap outside steering so queued calls recheck steering when they actually start.
 */
export function orderedBrowserTools(tools: ToolSet, batch = { failed: false }): ToolSet {
  let tail: Promise<unknown> = Promise.resolve();
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    if (!name.startsWith("browser_") || !execute) return [name, definition];
    return [name, { ...definition, execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
      const next = tail.then(async () => {
        if (batch.failed) throw new Error("A prior browser action in this batch failed. This action was not executed. Inspect the page and plan a new batch.");
        options.abortSignal?.throwIfAborted();
        try {
          const result = await execute(input, options);
          if (result && typeof result === "object" && "$toolError" in result && result.$toolError === true) batch.failed = true;
          return result;
        } catch (error) {
          batch.failed = true;
          throw error;
        }
      });
      tail = next.then(() => undefined, () => undefined);
      return next;
    } }];
  }));
}
