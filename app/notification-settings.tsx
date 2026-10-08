"use client";
import { useEffect, useState } from "react";
import { hasNativeBridge, postNativeMessage, type NativeWindow } from "./native-bridge";
import { SettingsGlyph } from "./settings-glyph";

type Status = "on" | "off" | "quiet" | "notDetermined";
export function NotificationSettings() {
  const [native, setNative] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!hasNativeBridge()) return;
    setNative(true);
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ status: Status; error?: string }>).detail;
      if (!detail || !["on", "off", "quiet", "notDetermined"].includes(detail.status)) return;
      setStatus(detail.status); setBusy(false); setError(detail.error || "");
    };
    const refresh = () => postNativeMessage({ version: 1, action: "notificationSettingsStatus" });
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("decisionFeed:notificationSettings", receive);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    refresh();
    return () => {
      window.removeEventListener("decisionFeed:notificationSettings", receive);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  if (!native) return null;
  const label = status === "on" ? "On" : status === "off" ? "Off" : status === "quiet" ? "Quietly" : status === "notDetermined" ? "Enable" : "Manage";
  return <>
    <button type="button" className="wd-you-row" disabled={busy} aria-label={`Notifications, ${label}`} onClick={() => {
      setError("");
      if (!(window as NativeWindow).__decisionFeedNativeNotificationSettings) { postNativeMessage({ version: 1, action: "openSystemSettings" }); return; }
      setBusy(true);
      postNativeMessage({ version: 1, action: "manageNotifications" });
    }}>
      <SettingsGlyph name="notifications" /><span>Notifications</span>
      <span className="wd-appearance-value">{busy ? "Opening…" : label}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></span>
    </button>
    {error && <p role="alert">{error}</p>}
  </>;
}
