"use client";
import { useEffect, useRef } from "react";
import type { RunningTask } from "../lib/types";
import { appleActionSource, usableAppleConnection } from "./apple-action-connection";
import { hasNativeAppleConnections, requestNativeApple } from "./native-bridge";

/** Mounted by the workspace, independently of the currently selected conversation. */
export function AppleActionRunner({ task, execute }: { task: RunningTask; execute: (task: RunningTask) => Promise<boolean> }) {
  const latest = useRef({ task, execute }); latest.current = { task, execute };
  useEffect(() => {
    if (!hasNativeAppleConnections()) return;
    let cancelled = false, checking = false, attempted = false;
    const visible = () => document.visibilityState !== "hidden";
    const run = async () => {
      if (cancelled || checking || attempted || !visible()) return;
      checking = true;
      try {
        const source = appleActionSource(latest.current.task.nativeAction?.operation ?? "");
        if (!source) return;
        const result = await requestNativeApple("status");
        if (cancelled || !visible() || !usableAppleConnection(result.connections?.find(item => item.id === source.id))) return;
        attempted = true;
        await latest.current.execute(latest.current.task);
      } catch { /* The shared execution retains errors for the conversation's retry control. */ }
      finally { checking = false; }
    };
    void run();
    window.addEventListener("focus", run); document.addEventListener("visibilitychange", run);
    return () => { cancelled = true; window.removeEventListener("focus", run); document.removeEventListener("visibilitychange", run); };
  }, [task.runId, task.actionId]);
  return null;
}
