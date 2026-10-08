import { inactiveBrowserTargets } from "./tab-lifecycle";
import { createCloudBrowserAccountState, BrowserlessCloudBrowserProvider, type CloudBrowserAccountState } from "./cloud";

declare global {
  var __decisionFeedBrowserRegistry: Map<string, BrowserlessCloudBrowserProvider> | undefined;
  var __decisionFeedBrowserAccounts: Map<string, CloudBrowserAccountState> | undefined;
}

const browsers = globalThis.__decisionFeedBrowserRegistry ??= new Map<string, BrowserlessCloudBrowserProvider>();
const accounts = globalThis.__decisionFeedBrowserAccounts ??= new Map<string, CloudBrowserAccountState>();

function registryKey(userId: string, targetKey: string) {
  return `${userId.trim().toLowerCase()}\u0000${targetKey}`;
}

export function getCloudBrowser(userId: string, targetKey = "shared") {
  const normalizedUserId = userId.trim().toLowerCase();
  const key = registryKey(normalizedUserId, targetKey);
  let browser = browsers.get(key);
  // Next.js development hot reload can preserve an instance created by an
  // older provider class. Replace that wrapper and reconnect to the same
  // metadata-addressed E2B sandbox instead of exposing a missing-method error.
  if (!browser || typeof browser.viewerHealth !== "function" || typeof browser.setWaitingForUser !== "function" || typeof browser.preflightRef !== "function" || typeof browser.warm !== "function" || typeof browser.watchUrl !== "function" || typeof browser.takeoverUrl !== "function" || typeof browser.maximize !== "function" || typeof browser.importCookies !== "function" || typeof browser.inspect !== "function" || typeof browser.waitFor !== "function" || typeof browser.press !== "function" || typeof browser.hover !== "function") {
    let account = accounts.get(normalizedUserId);
    if (!account) {
      account = createCloudBrowserAccountState();
      accounts.set(normalizedUserId, account);
    }
    browser = new BrowserlessCloudBrowserProvider(targetKey, account, normalizedUserId, () => inactiveBrowserTargets(normalizedUserId));
    browsers.set(key, browser);
  }
  return browser;
}

export async function closeCloudBrowser(userId: string) {
  const normalizedUserId = userId.trim().toLowerCase();
  const prefix = `${normalizedUserId}\u0000`;
  const entries = [...browsers.entries()].filter(([key]) => key.startsWith(prefix));
  const browser = entries[0]?.[1] ?? new BrowserlessCloudBrowserProvider("shared", accounts.get(normalizedUserId) ?? createCloudBrowserAccountState(), normalizedUserId);
  await browser.destroy();
  for (const [key] of entries) browsers.delete(key);
  accounts.delete(normalizedUserId);
}
