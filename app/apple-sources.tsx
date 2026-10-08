"use client";
import { SettingsDisclosure } from "./settings-disclosure";
import { SourceIcon } from "./source-icon";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { appleSources, type AppleConnection, type AppleSource } from "../lib/apple/catalog";
import { hasNativeAppleConnections, isNativeShell, postNativeMessage, requestNativeApple } from "./native-bridge";

export function useAppleConnections(previewMode: boolean) {
  const [connections, setConnections] = useState<AppleConnection[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const supported = hasNativeAppleConnections();
    setAvailable(supported);
    if (!supported || previewMode) return;
    setLoading(true);
    try { setConnections((await requestNativeApple("status")).connections ?? []); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't check your connections."); }
    finally { setLoading(false); }
  }, [previewMode]);
  useEffect(() => {
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  return { connections, setConnections, available, loading, error, setError, refresh };
}
export type AppleConnectionsState = ReturnType<typeof useAppleConnections>;
export function AppleSources({ state, search = "", children }: { state: AppleConnectionsState; search?: string; children?: ReactNode }) {
  const [busy, setBusy] = useState<AppleSource | null>(null);
  const change = async (service: AppleSource, enabled: boolean) => {
    if (busy) return;
    setBusy(service); state.setError("");
    try { state.setConnections((await requestNativeApple(enabled ? "disconnect" : "connect", { service })).connections ?? []); }
    catch (caught) { const message = caught instanceof Error ? caught.message : "Couldn't change this connection."; await state.refresh(); state.setError(message); }
    finally { setBusy(null); }
  };
  const sources = appleSources.filter(source => `apple ${source.name} ${search.trim().length >= 3 ? source.detail : ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  if (!sources.length && !children) return null;
  return <section className="wd-you-group wd-apple-sources">
    <h2>Apple</h2>
    {children}
    {state.available === false && sources.length > 0 && <p className="wd-you-note">{isNativeShell() ? "Update Dash to connect the other Apple apps." : "To connect the other Apple apps, open Dash on your iPhone."}</p>}
    {state.loading && <p className="wd-you-note" role="status">Checking connections…</p>}
    {state.error && <p className="wd-you-error" role="alert">{state.error}</p>}
    {sources.map((source) => {
      const connection = state.connections.find((item) => item.id === source.id);
      const enabled = connection?.enabled ?? false;
      const unavailable = connection?.status === "unavailable";
      const denied = connection?.status === "denied";
      const limited = connection?.status === "limited";
      return <SettingsDisclosure className="wd-source-detail" key={source.id}>
        <summary className="wd-source-summary"><SourceIcon name={source.id} row /><strong>{source.id === "motion" ? "Steps & activity" : source.name.replace("Files & iCloud Drive", "Files").replace("Apple ", "")}</strong><span className={`wd-source-state${enabled && !denied && !limited && !unavailable ? " is-connected" : ""}`}>{denied ? <button type="button" className="wd-source-connect wd-btn is-primary" disabled={!state.available} aria-label={`Open Settings for ${source.name}`} onClick={event => { event.preventDefault(); event.stopPropagation(); postNativeMessage({ version: 1, action: "openSystemSettings" }); }}>Open Settings</button> : unavailable ? <span>Unavailable</span> : enabled ? <span aria-label={limited ? "Limited access" : "Connected"}>{limited ? "Limited access" : "✓"}</span> : <button type="button" className="wd-source-connect wd-btn is-primary" disabled={!state.available || Boolean(busy) || state.loading || unavailable} aria-label={`Connect ${source.name}`} onClick={event => { event.preventDefault(); event.stopPropagation(); void change(source.id, false); }}>{busy === source.id ? "Connecting…" : unavailable ? "Unavailable" : "Connect"}</button>}</span></summary>
        <div className="wd-source-description">
        <p className="wd-you-note">{source.detail}</p>
        <p className="wd-you-note">Dash shares the information it needs with its AI services to help you.</p>
        {!state.available && <p className="wd-you-note">{isNativeShell() ? "Update the Dash iPhone app to connect this source." : "Open Dash on your iPhone to connect this source."}</p>}
        {connection?.detail && <p className="wd-you-note">{connection.detail}</p>}

        <div className="wd-apple-source-actions">
          <button type="button" className={`wd-btn ${enabled ? "is-text" : "is-secondary"} is-compact`} disabled={!state.available || Boolean(busy) || state.loading || (unavailable && !enabled)} aria-label={`${enabled ? "Disconnect" : "Connect"} ${source.name}`} onClick={() => void change(source.id, enabled)}>{busy === source.id ? (enabled ? "Disconnecting…" : "Connecting…") : enabled ? "Disconnect" : unavailable ? "Unavailable" : "Connect"}</button>
          {["denied", "limited"].includes(connection?.status ?? "") && <button type="button" className="wd-btn is-text is-compact" onClick={() => postNativeMessage({ version: 1, action: "openSystemSettings" })}>Open Settings</button>}
        </div>
        {enabled && <p className="wd-you-note">Disconnect stops future access through Dash. iPhone permissions and previously shared messages stay unchanged.</p>}
        </div>
      </SettingsDisclosure>;
    })}
  </section>;
}
