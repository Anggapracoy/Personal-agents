import type { AgentRunSnapshot } from "../lib/harness/types";

/** Reconcile the visible conversation even when its workspace SSE is interrupted. */
export function watchConversation(runId: string, receive: (snapshot: AgentRunSnapshot) => void) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  let previous = "";
  let interval = 2_000;
  const refresh = async () => {
    if (controller.signal.aborted || loading) return;
    clearTimeout(timer);
    loading = true;
    try {
      if (document.hidden) return;
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) return;
      const snapshot = await response.json() as AgentRunSnapshot;
      if (controller.signal.aborted) return;
      interval = ["done", "failed", "cancelled"].includes(snapshot.status) ? 5_000 : 2_000;
      const serialized = JSON.stringify(snapshot);
      if (serialized !== previous) { previous = serialized; receive(snapshot); }
    } catch { /* Keep visible messages and recover on the next poll or foreground event. */ }
    finally {
      loading = false;
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), interval);
    }
  };
  const foreground = () => { void refresh(); };
  window.addEventListener("focus", foreground);
  document.addEventListener("visibilitychange", foreground);
  void refresh();
  return () => {
    controller.abort(); clearTimeout(timer);
    window.removeEventListener("focus", foreground);
    document.removeEventListener("visibilitychange", foreground);
  };
}
