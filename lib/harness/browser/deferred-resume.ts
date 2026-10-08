import { timeHarnessOperation } from "../timing";

/** Keep old browser sessions off text-only turns' startup path. */
export function withDeferredBrowserResume<T extends { setWaitingForUser(waiting: boolean, reconnectExisting?: boolean): Promise<void> }>(browser: T, signal?: AbortSignal): T {
  let resumed: Promise<void> | undefined;
  return new Proxy(browser, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function" || key === "constructor") return value;
      // Lifecycle calls must not wake a session just to pause or dispose it.
      if (key === "setWaitingForUser" || key === "destroy" || key === "currentUrl") return value.bind(target);
      return async (...args: unknown[]) => {
        signal?.throwIfAborted();
        resumed ??= timeHarnessOperation("browser.resume", () => target.setWaitingForUser(false, true));
        await resumed;
        signal?.throwIfAborted();
        return value.apply(target, args);
      };
    },
  });
}
