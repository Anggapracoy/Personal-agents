"use client";
import type { AgentRunSnapshot } from "../lib/harness/types";

export type VaultItemSummary = { id: string; kind: "login" | "payment_card"; label: string; siteHost: string | null; usernameHint: string | null; cardBrand: string | null; cardLast4: string | null; updatedAt: string };
type NativeBridge = {
  postMessage: (message: unknown) => void;
};
export type NativeVaultResult = { requestId: string; ok: boolean; phase?: "authenticated"; item?: VaultItemSummary; deleted?: boolean; snapshot?: AgentRunSnapshot; error?: string };
type NativeGoogleReconnectResult = { requestId: string; runId: string; ok: boolean; error?: string };
export type NativeWindow = Window & {
  webkit?: { messageHandlers?: { decisionFeedNative?: NativeBridge } };
  __decisionFeedNativeShell?: boolean;
  __decisionFeedNativeNotificationSettings?: boolean;
  __decisionFeedNativeMessageFeedback?: boolean;
  __decisionFeedNativeSendFlight?: boolean;
  __decisionFeedNativeComposer?: boolean;
  __decisionFeedNativeHomeHeader?: boolean;
  __decisionFeedNativeHomeAvatar?: boolean;
  __decisionFeedNativeChromeBatch?: boolean;
  __decisionFeedNativeChatHeader?: boolean;
  __decisionFeedNativeBrowserClose?: boolean;
  __decisionFeedNativeGlassButtons?: boolean;
  __decisionFeedNativeConversationMenus?: boolean;
  __decisionFeedNativeMessageMenus?: boolean;
  __decisionFeedMessageAction?: (key: string, action: string, emoji: string | null) => Promise<void>;
  __decisionFeedNativeLocation?: boolean;
  __decisionFeedNativeSavePhotos?: boolean;
  __decisionFeedNativeVaultSelection?: boolean;
  __decisionFeedNativeGoogleConnectionCompletion?: boolean;
  decisionFeedInitialSignupScanRequested?: boolean;
};

export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}

const chromeActions = new Set(["navigationFrame", "navigationMotion", "homeHeaderState", "chatHeaderState", "chatHeaderHide", "glassButtonState", "browserCloseState", "sheetCoverage", "modalOverlayVisibility", "browserViewerVisibility", "composerState", "composerHide", "composerBlur", "composerFocus"]);
const pendingChrome = new Map<NativeBridge, unknown[]>();
function flushChrome(bridge: NativeBridge) {
  const messages = pendingChrome.get(bridge);
  if (!messages?.length) return;
  pendingChrome.delete(bridge);
  bridge.postMessage({ version: 1, action: "chromeBatch", payload: { messages } });
}
export function postNativeMessage(message: unknown) {
  const native = window as NativeWindow;
  const bridge = native.webkit?.messageHandlers?.decisionFeedNative;
  if (!bridge) return;
  const envelope = message as { version?: number; action?: string; payload?: unknown } | null;
  if (native.__decisionFeedNativeChromeBatch && envelope?.version === 1 && typeof envelope.action === "string" && chromeActions.has(envelope.action)) {
    let messages = pendingChrome.get(bridge);
    if (!messages) {
      messages = []; pendingChrome.set(bridge, messages);
      queueMicrotask(() => flushChrome(bridge));
    }
    messages.push(message);
    // Top-layer activation can change occlusion without changing an element's
    // bounds. Include the controls' current visibility in this same native pass.
    if (envelope.action === "modalOverlayVisibility" || envelope.action === "browserViewerVisibility") window.dispatchEvent(new Event("decisionFeed:sheetLayout"));
    if (messages.length >= 128) flushChrome(bridge);
    return;
  }
  // Keep permission requests, actions and other messages in their original order.
  flushChrome(bridge);
  bridge.postMessage(message);
}

export function hasNativeBridge() {
  return Boolean((window as NativeWindow).webkit?.messageHandlers?.decisionFeedNative);
}

export function hasNativeVaultSelection() {
  return typeof window !== "undefined" && (window as NativeWindow).__decisionFeedNativeVaultSelection === true;
}

export async function requestNativeVault(action: "vaultSave" | "vaultDelete" | "vaultDeleteAll" | "vaultRelease", payload: Record<string, unknown>, onAuthenticated?: () => void) {
  if (!(window as NativeWindow).webkit?.messageHandlers?.decisionFeedNative) throw new Error("Open the Dash iPhone app to use your device vault.");
  const requestId = crypto.randomUUID();
  return new Promise<NativeVaultResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("decisionFeed:vaultResult", receive as EventListener);
      reject(new Error("The iPhone vault request timed out."));
    }, 120_000);
    const receive = (event: Event) => {
      const result = (event as CustomEvent<NativeVaultResult>).detail;
      if (result?.requestId !== requestId) return;
      if (result.ok && result.phase === "authenticated") { onAuthenticated?.(); return; }
      window.clearTimeout(timeout);
      window.removeEventListener("decisionFeed:vaultResult", receive as EventListener);
      if (result.ok) resolve(result);
      else reject(new Error(result.error || "The iPhone vault request failed."));
    };
    window.addEventListener("decisionFeed:vaultResult", receive as EventListener);
    postNativeMessage({ version: 1, action, payload: { ...payload, requestId } });
  });
}

export async function requestNativeGoogleReconnect(runId: string) {
  if (!(window as NativeWindow).__decisionFeedNativeGoogleConnectionCompletion) throw new Error("Update the Dash iPhone app to reconnect Google securely.");
  if (!(window as NativeWindow).webkit?.messageHandlers?.decisionFeedNative) throw new Error("Open the Dash iPhone app to reconnect Google.");
  const startResponse = await fetch(`/api/connections/google/start?native=1&completion=1&runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (!startResponse.ok) throw new Error(await responseError(startResponse, "Google reconnect could not be started."));
  const start = await startResponse.json() as { authorizationUrl?: string };
  if (!start.authorizationUrl) throw new Error("Google reconnect could not be started.");
  return completeNativeGoogleConnection(runId, start.authorizationUrl);
}

export function nativeGoogleConnectionAvailable() {
  return typeof window !== "undefined" && Boolean((window as NativeWindow).__decisionFeedNativeGoogleConnectionCompletion
    && (window as NativeWindow).webkit?.messageHandlers?.decisionFeedNative);
}

/** Reuse the existing account-link flow; no task is needed to repair a source. */
export async function requestNativeGoogleConnection() {
  if (!nativeGoogleConnectionAvailable()) throw new Error("Update the Dash iPhone app to reconnect Google securely.");
  const response = await fetch("/api/mobile/onboarding/google", { cache: "no-store", headers: { "x-dash-google-connection-completion": "1" } });
  if (!response.ok) throw new Error(await responseError(response, "Google reconnect could not be started."));
  const start = await response.json() as { authorizationUrl?: string; connectionId?: string };
  if (!start.authorizationUrl || !start.connectionId) throw new Error("Google reconnect could not be started.");
  return completeNativeGoogleConnection(start.connectionId, start.authorizationUrl);
}

function completeNativeGoogleConnection(runId: string, authorizationUrl: string) {
  const requestId = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("decisionFeed:googleReconnectResult", receive as EventListener);
      reject(new Error("Google reconnect timed out."));
    }, 180_000);
    const receive = (event: Event) => {
      const result = (event as CustomEvent<NativeGoogleReconnectResult>).detail;
      if (result?.requestId !== requestId || result.runId !== runId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("decisionFeed:googleReconnectResult", receive as EventListener);
      if (result.ok) resolve();
      else reject(new Error(result.error || "Google reconnect did not finish."));
    };
    window.addEventListener("decisionFeed:googleReconnectResult", receive as EventListener);
    postNativeMessage({ version: 1, action: "reconnectGoogle", payload: { requestId, runId, authorizationUrl } });
  });
}

export async function unregisterNativePushToken() {
  if (!(window as NativeWindow).webkit?.messageHandlers?.decisionFeedNative) return;
  await new Promise<void>((resolve) => {
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("decisionFeed:pushTokenUnregistered", complete);
      resolve();
    };
    window.addEventListener("decisionFeed:pushTokenUnregistered", complete, { once: true });
    postNativeMessage({ version: 1, action: "unregisterPushToken" });
    window.setTimeout(complete, 2_000);
  });
}


export function rateLimitMessage(retryAfterSeconds: number) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const wait = !Number.isFinite(minutes) || minutes <= 1 ? "a minute" : minutes >= 55 ? "about an hour" : `${minutes} minutes`;
  return `You’ve hit the limit for now. Try again in ${wait}.`;
}

export async function responseError(response: Response, fallback: string) {
  if (response.status === 429) return rateLimitMessage(Number(response.headers.get("retry-after")));
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
}


export function isNativeShell() {
  if (typeof window === "undefined") return false;
  return Boolean((window as NativeWindow).__decisionFeedNativeShell) || /DecisionFeed-iOS\//.test(navigator.userAgent);
}

/** Sign-in handoff: the native app opens the site in an isolated in-app browser and returns the session cookies for this run. */
export type NativeSignInResult = { runId: string; ok: boolean; finalUrl?: string; cookies?: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires?: number | null; sameSite?: "Strict" | "Lax" | "None" | null }> };
export async function requestNativeSignIn(runId: string, url: string, host: string) {
  if (!hasNativeBridge()) throw new Error("Open the Dash iPhone app to sign in.");
  return new Promise<NativeSignInResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("decisionFeed:signInResult", receive as EventListener);
      reject(new Error("The sign-in timed out."));
    }, 15 * 60_000);
    const receive = (event: Event) => {
      const result = (event as CustomEvent<NativeSignInResult>).detail;
      if (result?.runId !== runId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("decisionFeed:signInResult", receive as EventListener);
      resolve(result);
    };
    window.addEventListener("decisionFeed:signInResult", receive as EventListener);
    postNativeMessage({ version: 1, action: "openSignInSheet", payload: { runId, url, host } });
  });
}

export function hasNativeAppleConnections() {
  return typeof window !== "undefined" && Boolean((window as NativeWindow & { __decisionFeedNativeAppleConnections?: boolean }).__decisionFeedNativeAppleConnections);
}
export type NativeAppleResult = { requestId: string; ok: boolean; connections?: import("../lib/apple/catalog").AppleConnection[]; snapshot?: AgentRunSnapshot; error?: string };
export async function requestNativeApple(kind: "status" | "connect" | "disconnect" | "execute", payload: Record<string, unknown> = {}) {
  if (!hasNativeAppleConnections()) throw new Error("Open the latest Dash iPhone app to use Apple sources.");
  const requestId = crypto.randomUUID();
  return new Promise<NativeAppleResult>((resolve, reject) => {
    const receive = (event: Event) => {
      const result = (event as CustomEvent<NativeAppleResult>).detail;
      if (result?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("decisionFeed:appleConnectionsResult", receive);
      if (result.ok) resolve(result); else reject(new Error(result.error || "The iPhone request could not finish."));
    };
    const timeout = window.setTimeout(() => {
      window.removeEventListener("decisionFeed:appleConnectionsResult", receive);
      reject(new Error("The iPhone has not returned a result. Reopen this screen and retry; saved actions will not run twice."));
    }, kind === "status" ? 15_000 : 180_000);
    window.addEventListener("decisionFeed:appleConnectionsResult", receive);
    postNativeMessage({ version: 1, action: "appleConnections", payload: { ...payload, kind, requestId } });
  });
}

export async function confirmConversationArchive(source: HTMLElement): Promise<boolean> {
  const native = window as NativeWindow & { __decisionFeedNativeArchiveConfirmation?: boolean };
  if (!native.__decisionFeedNativeArchiveConfirmation) return window.confirm('Move this conversation to Archived? You can restore it later.');
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const finish = (confirmed: boolean) => { window.clearTimeout(timer); window.removeEventListener('decisionFeed:archiveConfirmation', receive); resolve(confirmed); };
    const receive = (event: Event) => { const result = (event as CustomEvent<{ requestId: string; confirmed: boolean }>).detail; if (result?.requestId === requestId) finish(result.confirmed); };
    const timer = window.setTimeout(() => finish(false), 120_000);
    window.addEventListener('decisionFeed:archiveConfirmation', receive);
    const box = source.getBoundingClientRect();
    postNativeMessage({ version: 1, action: 'confirmArchive', payload: { requestId, y: box.y + box.height / 2 - 24 } });
  });
}
