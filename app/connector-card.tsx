"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Receipt } from "./receipt";
import { hasNativeBridge, postNativeMessage } from "./native-bridge";
import type { RunningTask } from "../lib/types";

export function ConnectorIcon({ name, logo }: { name: string; logo?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="wd-connect-app-icon" aria-hidden="true">{logo && !failed ? <img src={logo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : name.slice(0, 1)}</span>;
}
export function ConnectorReceipt({ name, logo, status = "Connected" }: { name: string; logo?: string; status?: string }) {
  return <Receipt icon={<ConnectorIcon name={name} logo={logo} />} title={name} detail={status} label={`${name} ${status}`} />;
}
export function ConnectorCard({ task, onConnected, onSkip, skipping = false }: { task: RunningTask; onConnected: () => Promise<boolean>; onSkip: () => void; skipping?: boolean }) {
  const name = task.approvalRequest?.appName ?? "this app";
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const connectionURL = useRef<string | null>(null);
  const checking = useRef(false);
  const completed = useRef(false);
  const callbacks = useRef(onConnected); callbacks.current = onConnected;
  const endpoint = `/api/runs/${encodeURIComponent(task.runId ?? "")}/connection?actionId=${encodeURIComponent(task.actionId ?? "")}`;
  const finish = useCallback(async () => {
    if (completed.current) return;
    completed.current = true;
    if (connectionURL.current) {
      postNativeMessage({ version: 1, action: "closeConnectorBrowser", payload: { url: connectionURL.current } });
      connectionURL.current = null;
    }
    try { if (!await callbacks.current()) throw new Error("Connected, but Dash couldn’t continue. Try again."); }
    catch (caught) { completed.current = false; setError(caught instanceof Error ? caught.message : "Couldn't continue. Try again."); }
  }, []);
  const check = useCallback(async () => {
    if (checking.current || completed.current || (document.visibilityState !== "visible" && !hasNativeBridge())) return;
    checking.current = true;
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.connected === true) await finish();
    } catch { /* A temporary network failure must not create a false receipt. */ }
    finally { checking.current = false; }
  }, [endpoint, finish]);
  useEffect(() => {
    void check();
    const refresh = () => void check();
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, waiting ? 4000 : 15000);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [check, waiting]);
  const connect = async () => {
    if (busy || skipping) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't start sign-in. Try again.");
      if (data.connected === true) { await finish(); return; }
      if (typeof data.url !== "string") throw new Error("Couldn't start sign-in. Try again.");
      connectionURL.current = data.url;
      setWaiting(true);
      window.location.assign(data.url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't connect. Try again."); }
    finally { setBusy(false); }
  };
  return <section className="wd-card wd-connect-card" aria-label={`Connect ${name}`}>
    <div className="wd-connect-heading"><ConnectorIcon name={name} logo={task.approvalRequest?.appLogo} /><div><h3>Connect {name}</h3><span>Continue with your account</span></div></div>
    <p className="wd-connect-reason">{task.approvalRequest?.reason || `Connect ${name} so I can help with this.`}</p>
    <div className="wd-connect-actions"><button type="button" className="wd-btn is-primary" onClick={() => void connect()} disabled={busy || skipping} aria-busy={busy}>{busy ? <span className="wd-spinner" aria-hidden="true" /> : null}<span>Connect {name}</span></button><button type="button" className="wd-btn is-text" onClick={onSkip} disabled={busy || skipping}>{skipping ? "Skipping…" : "Not now"}</button></div>
    {waiting && !error && <p className="wd-connect-note" role="status">Finish signing in. I’ll continue when you’re connected.</p>}
    {error && <p className="wd-you-error" role="alert">{error}</p>}
  </section>;
}
