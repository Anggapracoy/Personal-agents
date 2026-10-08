"use client";
import type { RunningTask } from "../lib/types";
import type { AgentAction } from "../lib/harness/types";
import { CloudBrowserPanel, type BrowserFrame } from "./browser-viewer";
export type { BrowserFrame } from "./browser-viewer";

/** Hosts the full-screen browser viewer in the current modal and supplies current run data. */
export function BrowserSheet({ runId, task, frames, actions = [], control, frameId, closeForAttention, onControlChange, onDone, onClose }: {
  runId: string; task?: RunningTask; frames: BrowserFrame[]; actions?: AgentAction[]; control: boolean; frameId?: string | null;
  closeForAttention: boolean; onControlChange: (enabled: boolean) => void; onDone: () => Promise<boolean>; onClose: () => void;
}) {
  const active = task?.status === "running" || task?.status === "needs_approval";
  const steps = actions.map(action => ({ label: action.preview.split("\n")[0] || action.toolName, detail: action.preview,
    status: action.status === "executed" ? "done" as const : action.status === "failed" || action.status === "rejected" ? "failed" as const : action.status === "proposed" ? "approval" as const : "active" as const }));
  return <div className="wd-sheet-root wd-browser-legacy">
    <CloudBrowserPanel task={{ title: task?.title ?? "Browser", subtitle: task?.subtitle ?? frames.at(-1)?.label ?? "", status: task?.status ?? "waiting", approvalKind: task?.approvalKind, browserUsed: task?.browserUsed ?? frames.length > 0, runId, browserFrames: frames, steps }} liveAvailable={active} controlRequested={control} initialFrameId={frameId}
        closeForAttention={closeForAttention} onControlModeChange={onControlChange} onResumeTask={onDone} onClose={onClose} />
  </div>;
}
