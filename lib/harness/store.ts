
import { BrowserTakeoverInterrupted } from "./execution-lock";
import { notificationReplyId, notificationReplyMessage, notificationReplyMetadata, previousResultMessage, type NotificationReplyInput, type NotificationReplyResult } from "./notification-reply";
import { timedRunStore } from "./timing";
import { reactionOf } from "./reactions";
import { pendingSteering } from "./steering";
import { completedToolHistoryPatch } from "./completed-tool-output";
import { newTurnActivityMetadata } from "./tool-activity-state";
import { hasUnreadRuntimeResult } from "./runtime-message";
import equal from "fast-deep-equal";
import postgres from "postgres";
import { decryptSecret, encryptSecret } from "./secrets";
import type { ModelMessage } from "ai";
import type { AgentAction, AgentArtifact, AgentMessage, AgentRun, AgentRunSnapshot, RunStore } from "./types";

type MemoryState = { runs: Map<string, AgentRun>; messages: Map<string, AgentMessage>; actions: Map<string, AgentAction>; artifacts: Map<string, AgentArtifact>; secrets: Map<string, string> };

declare global { var __decisionFeedHarnessStore: MemoryState | undefined; }

const memory = globalThis.__decisionFeedHarnessStore ??= {
  runs: new Map(), messages: new Map(), actions: new Map(), artifacts: new Map(), secrets: new Map(),
};
const executionLocks = new Set<string>();
memory.secrets ??= new Map();
memory.messages ??= new Map();

function now() { return new Date().toISOString(); }
function deliveredArtifactIds(messages: AgentMessage[]) {
  const ids: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === "artifactId" && typeof child === "string") ids.push(child);
      else visit(child);
    }
  };
  for (const item of messages) visit(item.message.providerOptions?.wdyt);
  return ids;
}


function latestArtifactsByName<T extends Pick<AgentArtifact, "name" | "id">>(artifacts: T[], deliveredIds: string[] = []) {
  const latest = new Map<string, T>();
  for (const artifact of artifacts) {
    const key = artifact.name.toLowerCase();
    // Reinsert so the resulting list also follows the latest capture order.
    latest.delete(key);
    latest.set(key, artifact);
  }
  const retained = new Set([...latest.values()].map(artifact => artifact.id));
  for (const id of deliveredIds) retained.add(id);
  return artifacts.filter(artifact => retained.has(artifact.id));
}

export class MemoryRunStore implements RunStore {
  async acceptReply(id: string, message: ModelMessage, patch: Record<string, unknown> = {}): Promise<"started" | "steering" | "busy" | "missing"> {
    const run = memory.runs.get(id);
    if (!run) return "missing";
    if (run.status === "paused" && (run.metadata.automaticPause as { ready?: boolean } | undefined)?.ready === false) return "busy";
    const active = run.status === "running" || run.status === "planning";
    const item: AgentMessage = { id: crypto.randomUUID(), runId: id, seq: 0, message, createdAt: now() };
    if (active) {
      memory.runs.set(id, { ...run, metadata: { ...run.metadata, ...patch, pendingSteering: [...pendingSteering(run), item] }, updatedAt: now() });
      return "steering";
    }
    let seq = Math.max(0, ...[...memory.messages.values()].filter(m => m.runId === id).map(m => m.seq));
    const completed = completedToolHistoryPatch(run, seq);
    for (const previous of previousResultMessage(run)) {
      const context = { id: crypto.randomUUID(), runId: id, seq: ++seq, message: previous, createdAt: now() };
      memory.messages.set(context.id, context);
    }
    memory.messages.set(item.id, { ...item, seq: ++seq });
    memory.runs.set(id, { ...run, metadata: { ...notificationReplyMetadata(run), ...patch, ...completed }, status: "running", response: "", result: null, error: null, completedAt: null, updatedAt: now() });
    return "started";
  }
  async beginManualTakeover(runId: string, owner: string, pageUrl?: string): Promise<AgentAction | null> {
    const run = memory.runs.get(runId);
    if (!run || run.userId.toLowerCase() !== owner.toLowerCase()) return null;
    const pending = [...memory.actions.values()].filter(action => action.runId === runId && action.status === "proposed");
    const existing = pending.find(action => action.toolName === "browser_request_takeover" && action.input.mode !== "wait_for_user");
    if (existing && run.status === "awaiting_approval") return existing;
    if (run.status !== "running" || pending.some(action => action.risk === "write_external")) return null;
    const id = crypto.randomUUID();
    const action: AgentAction = { id, runId, stepId: null, scopeId: typeof run.metadata.actionScopeId === "string" ? run.metadata.actionScopeId : null,
      toolName: "browser_request_takeover", risk: "write_external", preview: "You have control of the browser.\nTap Continue when you are ready for Dash to resume.",
      input: { manual: true, reason: "You took control of the browser", instructions: "Tap Continue when finished.", ...(pageUrl ? { pageUrl } : {}) },
      status: "proposed", result: null, approvedBy: null, approvedAt: null, executedAt: null, createdAt: now() };
    memory.actions.set(id, action);
    memory.runs.set(runId, { ...run, status: "awaiting_approval", updatedAt: now(), metadata: { ...run.metadata, manualTakeoverEpoch: id, replyTyping: false, toolActivity: null } });
    return action;
  }
  async withExecutionLock<T>(runId: string, execute: (assertOwned: () => Promise<void>, run?: AgentRun | null) => Promise<T>, options: { loadRun?: boolean } = {}): Promise<{ acquired: false } | { acquired: true; value: T }> {
    if (executionLocks.has(runId)) return { acquired: false };
    executionLocks.add(runId);
    let active = true;
    const initial = options.loadRun ? await this.getRun(runId) : undefined;
    try { return { acquired: true, value: await execute(async () => {
      if (!active) throw new Error("Execution lock lost");
      if (options.loadRun && memory.runs.get(runId)?.metadata.manualTakeoverEpoch !== initial?.metadata.manualTakeoverEpoch) throw new BrowserTakeoverInterrupted();
    }, initial) }; }
    finally { active = false; executionLocks.delete(runId); }
  }
  async createRun(input: Pick<AgentRun, "userId" | "decisionId" | "category" | "request" | "title" | "metadata">, initialMessages?: (run: AgentRun) => ModelMessage[], initialSecrets: Record<string, string> = {}) {
    const timestamp = now();
    const run: AgentRun = { ...input, id: crypto.randomUUID(), response: "", result: null, status: "planning", error: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null };
    const messages = initialMessages?.(run) ?? [];
    if (messages.length) run.status = "running";
    memory.runs.set(run.id, run);
    messages.forEach((message, index) => { const id = crypto.randomUUID(); memory.messages.set(id, { id, runId: run.id, seq: index + 1, message, createdAt: timestamp }); });
    for (const [key, value] of Object.entries(initialSecrets)) memory.secrets.set(`${run.id}:${key}`, value);
    return run;
  }
  async getRun(id: string) { return memory.runs.get(id) ?? null; }
  async searchOwnedChats(owner: string, query: string, excludeRunId: string, offset: number, limit: number) {
    const needle = query.toLowerCase();
    return [...memory.runs.values()].filter(run => run.userId.toLowerCase() === owner.toLowerCase() && run.id !== excludeRunId)
      .filter(run => [run.title, run.request, run.response, ...[...memory.messages.values()].filter(m => m.runId === run.id && ["user", "assistant"].includes(m.message.role)).map(m => typeof m.message.content === "string" ? m.message.content : m.message.content.filter((p: {type: string; text?: string}) => p.type === "text").map((p: {text?: string}) => p.text).join(" "))].some(text => text?.toLowerCase().includes(needle)))
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(offset, offset + limit);
  }

  async acceptNotificationReply(input: NotificationReplyInput): Promise<NotificationReplyResult | null> {
    let run = input.runId ? memory.runs.get(input.runId) : [...memory.runs.values()]
      .filter(row => row.userId === input.owner && row.decisionId === input.decisionId).sort((a, b) => {
        const seen = (candidate: AgentRun) => candidate.metadata.initialNotificationReplyId === input.eventId || [...memory.messages.values(), ...pendingSteering(candidate)].some(item => item.runId === candidate.id && notificationReplyId(item.message) === input.eventId);
        return Number(seen(b)) - Number(seen(a)) || b.createdAt.localeCompare(a.createdAt);
      })[0];
    if (!run && !input.runId && input.decisionId && input.newRun) {
      const timestamp = now();
      run = { ...input.newRun, id: crypto.randomUUID(), userId: input.owner, decisionId: input.decisionId,
        metadata: { ...input.newRun.metadata, initialNotificationReplyId: input.eventId },
        status: "planning", response: "", result: null, error: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null };
      memory.runs.set(run.id, run);
      return { run, mode: "started" };
    }
    if (!run || run.userId !== input.owner) return null;
    if (run.metadata.initialNotificationReplyId === input.eventId || [...memory.messages.values(), ...pendingSteering(run)]
      .some(item => item.runId === run.id && notificationReplyId(item.message) === input.eventId)) return { run, mode: "duplicate" };
    if (run.status === "paused" && (run.metadata.automaticPause as { ready?: boolean } | undefined)?.ready === false) throw new Error("This conversation is resuming. Try again in a moment.");
    const active = ["planning", "running"].includes(run.status);
    const message = notificationReplyMessage(input);
    const item: AgentMessage = { id: crypto.randomUUID(), runId: run.id, seq: 0, message, createdAt: now() };
    if (active) run = { ...run, metadata: { ...run.metadata, pendingSteering: [...pendingSteering(run), item] }, updatedAt: now() };
    else {
      let seq = Math.max(0, ...[...memory.messages.values()].filter(m => m.runId === run.id).map(m => m.seq));
      const completed = completedToolHistoryPatch(run, seq);
      for (const previous of previousResultMessage(run)) {
        const context = { id: crypto.randomUUID(), runId: run.id, seq: ++seq, message: previous, createdAt: now() };
        memory.messages.set(context.id, context);
      }
      memory.messages.set(item.id, { ...item, seq: ++seq });
      for (const action of memory.actions.values()) if (action.runId === run.id && ["proposed", "approved"].includes(action.status) && !action.result?.executionStartedAt) memory.actions.set(action.id, { ...action, status: "rejected" });
      run = { ...run, metadata: { ...notificationReplyMetadata(run), ...completed }, status: "running", result: null, response: "", error: null, completedAt: null, updatedAt: now() };
    }
    memory.runs.set(run.id, run);
    return { run, mode: active ? "steering" : "started" };
  }
  async acceptReaction(id: string, message: ModelMessage): Promise<"started" | "steering" | "duplicate" | "busy"> {
    const run = memory.runs.get(id);
    const event = reactionOf(message);
    if (!run || !event || message.role !== "user") return "busy";
    if ([...memory.messages.values(), ...pendingSteering(run)].some(item => item.runId === id && reactionOf(item.message)?.eventId === event.eventId)) return "duplicate";
    const latest = [...memory.messages.values(), ...pendingSteering(run)].filter(item => item.runId === id && item.message.role === "user" && reactionOf(item.message)?.messageId === event.messageId).at(-1);
    if ((latest ? reactionOf(latest.message)?.emoji : event.messageId === `${id}:opening` ? run.metadata.initialReaction ?? null : null) === event.emoji) return "duplicate";
    if (run.status === "paused" && (run.metadata.automaticPause as { ready?: boolean } | undefined)?.ready === false) return "busy";
    const active = ["running", "planning"].includes(run.status);
    const item: AgentMessage = { id: crypto.randomUUID(), runId: id, seq: 0, message, createdAt: now() };
    const metadata: Record<string, unknown> = { ...run.metadata, ...(active ? {} : newTurnActivityMetadata) };
    if (active) metadata.pendingSteering = [...pendingSteering(run), item];
    else {
      metadata.reactionResumeStatus = ["paused", "awaiting_approval"].includes(run.status) ? run.status : null;
      delete metadata.automaticPause; delete metadata.pauseDispatchId;
      item.seq = Math.max(0, ...[...memory.messages.values()].filter(m => m.runId === id).map(m => m.seq)) + 1;
      Object.assign(metadata, completedToolHistoryPatch(run, item.seq - 1));
      memory.messages.set(item.id, item);
    }
    memory.runs.set(id, { ...run, metadata, ...(active ? {} : { status: "running" as const, result: null, response: "", error: null, completedAt: null }), updatedAt: now() });
    return active ? "steering" : "started";
  }
  async claimRunForReply(id: string) {
    const run = memory.runs.get(id);
    if (!run || ["planning", "running"].includes(run.status) || (run.status === "paused" && (run.metadata.automaticPause as { ready?: boolean } | undefined)?.ready === false)) return false;
    const metadata = { ...run.metadata, ...newTurnActivityMetadata };
    delete metadata.automaticPause;
    delete metadata.pauseDispatchId;
    memory.runs.set(id, { ...run, metadata, status: "running", updatedAt: now() });
    return true;
  }
  async enqueueSteering(id: string, message: ModelMessage) {
    const run = memory.runs.get(id);
    if (!run || !["running", "planning"].includes(run.status)) return false;
    const item: AgentMessage = { id: crypto.randomUUID(), runId: id, seq: 0, message, createdAt: now() };
    memory.runs.set(id, { ...run, metadata: { ...run.metadata, pendingSteering: [...pendingSteering(run), item] }, updatedAt: now() });
    return true;
  }
  async consumeSteering(id: string, requireHistory = false) {
    if (requireHistory && !await this.hasMessages(id)) return false;
    const run = memory.runs.get(id);
    const pending = pendingSteering(run);
    if (!run || run.status === "cancelled" || !pending.length) return false;
    let seq = Math.max(0, ...[...memory.messages.values()].filter(m => m.runId === id).map(m => m.seq));
    for (const item of pending) memory.messages.set(item.id, { ...item, seq: ++seq });
    const metadata = { ...run.metadata, ...newTurnActivityMetadata, pendingSteering: [] };
    delete metadata.automaticPause;
    delete metadata.pauseDispatchId;
    const reactionOnly = pending.every(item => reactionOf(item.message));
    if (reactionOnly && ["paused", "awaiting_approval"].includes(run.status)) (metadata as Record<string, unknown>).reactionResumeStatus = run.status;
    if (!reactionOnly) (metadata as Record<string, unknown>).reactionResumeStatus = null;
    for (const action of memory.actions.values()) if (!reactionOnly && action.runId === id && ["proposed", "approved"].includes(action.status) && !action.result?.executionStartedAt) memory.actions.set(action.id, { ...action, status: "rejected" });
    memory.runs.set(id, { ...run, metadata, status: "running", result: null, response: "", error: null, completedAt: null, updatedAt: now() });
    return true;
  }
  async restoreWaitingIfNoSteering(id: string, status: "paused" | "awaiting_approval") {
    const run = memory.runs.get(id);
    if (!run || run.status !== "running" || pendingSteering(run).length) return false;
    memory.runs.set(id, { ...run, status, updatedAt: now() });
    return true;
  }
  async finishRunIfNoSteering(id: string, result: AgentRun["result"], error?: string) {
    const run = memory.runs.get(id);
    if (!run || run.status !== "running" || pendingSteering(run).length || hasUnreadRuntimeResult(run)) return false;
    const metadata = error || result?.outcome === "needs_user" ? run.metadata : { ...run.metadata, completedToolHistorySeq: Math.max(0, ...[...memory.messages.values()].filter(m => m.runId === id).map(m => m.seq)) };
    memory.runs.set(id, { ...run, metadata, result, status: error ? "failed" : "done", error: error ?? null, completedAt: now(), updatedAt: now() });
    return true;
  }
  async acknowledgeRuntimeResults(id: string, throughSeq: number) {
    const run = memory.runs.get(id);
    if (!run || !Number.isSafeInteger(throughSeq) || throughSeq < 0) return;
    memory.runs.set(id, { ...run, metadata: { ...run.metadata, runtimeResultReadSeq: Math.max(Number(run.metadata.runtimeResultReadSeq ?? 0), throughSeq) } });
  }
  async findLatestRun(userId: string, decisionId: string) {
    return [...memory.runs.values()]
      .filter((run) => run.userId === userId && run.decisionId === decisionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }
  async getSnapshot(id: string): Promise<AgentRunSnapshot | null> {
    const run = await this.getRun(id); if (!run) return null;
    return { ...run, actions: [...memory.actions.values()].filter((a) => a.runId === id), artifacts: latestArtifactsByName([...memory.artifacts.values()].filter((a) => a.runId === id), deliveredArtifactIds([...memory.messages.values()].filter(m => m.runId === id))).map(({ bytesBase64: _, ...artifact }) => artifact) };
  }
  async getTurnSnapshot(id: string): Promise<(AgentRunSnapshot & { messages: AgentMessage[] }) | null> {
    const [snapshot, messages] = await Promise.all([this.getSnapshot(id), this.listMessages(id)]);
    return snapshot ? { ...snapshot, messages } : null;
  }
  async setConversationIdentity(id: string, ownerEmail: string, expectedTitle: string, identity: { title: string; category: string }) {
    const run = memory.runs.get(id);
    if (!run || run.userId !== ownerEmail || run.title !== expectedTitle || run.metadata.initialConversationTitle !== expectedTitle || run.metadata.conversationIdentityGenerated === true) return null;
    const retryDecision = run.metadata.retryDecision;
    const metadata = { ...run.metadata, conversationIdentityGenerated: true, ...(retryDecision && typeof retryDecision === "object" ? { retryDecision: { ...retryDecision, ...identity } } : {}) };
    const updated = { ...run, ...identity, metadata, updatedAt: now() };
    memory.runs.set(id, updated);
    return updated;
  }
  async updateRun(id: string, patch: Partial<Pick<AgentRun, "title" | "response" | "result" | "status" | "error" | "completedAt">>) { const run = memory.runs.get(id); if (!run) return null; const metadata = { ...run.metadata }; if (patch.status === "cancelled") { delete metadata.automaticPause; delete metadata.pauseDispatchId; } const next = { ...run, ...patch, metadata, updatedAt: now() }; memory.runs.set(id, next); return next; }
  async updateRunMetadata(id: string, patch: Record<string, unknown>, acknowledgeThroughSeq?: number) {
    if (acknowledgeThroughSeq !== undefined && (!Number.isSafeInteger(acknowledgeThroughSeq) || acknowledgeThroughSeq < 0)) throw new Error("Invalid runtime acknowledgement sequence.");
    const run = memory.runs.get(id); if (!run) return null;
    const metadata = { ...run.metadata, ...patch };
    if (acknowledgeThroughSeq !== undefined) metadata.runtimeResultReadSeq = Math.max(Number(run.metadata.runtimeResultReadSeq ?? 0), acknowledgeThroughSeq);
    const next = { ...run, metadata, updatedAt: now() }; memory.runs.set(id, next); return next;
  }
  async listMessages(runId: string) { return [...memory.messages.values()].filter((m) => m.runId === runId).sort((a, b) => a.seq - b.seq); }
  async getMessage(id: string, runId: string) { const message = memory.messages.get(id); return message?.runId === runId ? message : null; }
  async hasMessages(runId: string) {
    for (const message of memory.messages.values()) if (message.runId === runId) return true;
    return false;
  }
  async appendMessages(runId: string, messages: ModelMessage[], options?: { finishReplyTyping?: boolean }) {
    const existing = await this.listMessages(runId);
    let seq = existing.at(-1)?.seq ?? 0;
    if (options?.finishReplyTyping) {
      const run = memory.runs.get(runId);
      if (run) memory.runs.set(runId, { ...run, metadata: { ...run.metadata, replyTyping: false }, updatedAt: now() });
    }
    return messages.map((message) => { const item: AgentMessage = { id: crypto.randomUUID(), runId, seq: ++seq, message, createdAt: now() }; memory.messages.set(item.id, item); return item; });
  }
  async createAction(input: Omit<AgentAction, "id" | "result" | "status" | "approvedBy" | "approvedAt" | "executedAt">) { const action: AgentAction = { ...input, createdAt: now(), id: crypto.randomUUID(), result: null, status: "proposed", approvedBy: null, approvedAt: null, executedAt: null }; memory.actions.set(action.id, action); return action; }
  async findMatchingAction(runId: string, toolName: string, input: Record<string, unknown>, scopeId?: string | null) { return [...memory.actions.values()].find((action) => action.runId === runId && action.toolName === toolName && (action.scopeId ?? null) === (scopeId ?? null) && equal(action.input, input) && !["rejected", "failed"].includes(action.status)) ?? null; }
  async listExecutedActionsForDecision(userId: string, decisionId: string, toolName?: string) {
    const runIds = new Set([...memory.runs.values()].filter((run) => run.userId === userId && run.decisionId === decisionId).map((run) => run.id));
    return [...memory.actions.values()]
      .filter((action) => runIds.has(action.runId) && action.status === "executed" && (!toolName || action.toolName === toolName))
      .sort((a, b) => (b.executedAt ?? "").localeCompare(a.executedAt ?? ""));
  }
  async getAction(id: string, runId: string) { const action = memory.actions.get(id); return action?.runId === runId ? action : null; }
  async approveAction(id: string, runId: string, approvedBy: string, emailEdit?: { subject: string; body: string }) { const action = await this.getAction(id, runId); if (!action || action.status !== "proposed" || (emailEdit && !["gmail_send_draft", "icloud_send_email"].includes(action.toolName))) return null; const next: AgentAction = { ...action, status: "approved", approvedBy, approvedAt: now(), result: emailEdit ? { ...action.result, approvedEmailEdit: emailEdit } : action.result }; memory.actions.set(id, next); return next; }
  async rejectPendingActions(runId: string) { for (const action of memory.actions.values()) if (action.runId === runId && action.status === "proposed") memory.actions.set(action.id, { ...action, status: "rejected" }); }
  async skipAction(id: string, runId: string, skippedBy: string, result: Record<string, unknown>) {
    const action = await this.getAction(id, runId);
    if (!action || action.status !== "proposed") return null;
    const timestamp = now();
    const skipped: AgentAction = { ...action, status: "failed", result, approvedBy: skippedBy, approvedAt: timestamp, executedAt: timestamp };
    memory.actions.set(id, skipped);
    return skipped;
  }
  async claimDeviceAction(id: string, runId: string, owner: string, token: string) {
    const action = memory.actions.get(id), run = memory.runs.get(runId);
    if (!action || action.runId !== runId || action.toolName !== "apple_device" || action.status !== "proposed" || !run || run.userId.toLowerCase() !== owner.toLowerCase() || run.status !== "awaiting_approval") return false;
    memory.actions.set(id, { ...action, status: "approved", approvedBy: owner, approvedAt: now() });
    memory.secrets.set(`${runId}:apple_claim:${id}`, token);
    return true;
  }
  async completeDeviceAction(id: string, runId: string, status: "executed" | "failed", result: Record<string, unknown>, message: ModelMessage) {
    const action = memory.actions.get(id), run = memory.runs.get(runId);
    if (!action || action.runId !== runId || action.toolName !== "apple_device" || action.status !== "approved" || !run) return false;
    memory.actions.set(id, { ...action, status, result, executedAt: now() });
    if (["cancelled", "failed", "done"].includes(run.status)) return false;
    const seq = Math.max(0, ...[...memory.messages.values()].filter(m => m.runId === runId).map(m => m.seq)) + 1;
    const item: AgentMessage = { id: crypto.randomUUID(), runId, seq, message, createdAt: now() };
    memory.messages.set(item.id, item);
    memory.runs.set(runId, { ...run, metadata: { ...run.metadata, runtimeResultSeq: seq } });
    if (run.status !== "awaiting_approval") return false;
    memory.runs.set(runId, { ...run, status: "running", error: null, completedAt: null, updatedAt: now(), metadata: { ...run.metadata, runtimeResultSeq: seq, appleResumePending: id } });
    return true;
  }
  async markActionStarted(id: string) { const action = memory.actions.get(id); if (action) memory.actions.set(id, { ...action, result: { ...action.result, executionStartedAt: now() } }); }
  async completeAction(id: string, status: "executed" | "failed", result: Record<string, unknown>) { const action = memory.actions.get(id); if (!action) return null; const next: AgentAction = { ...action, status, result, executedAt: now() }; memory.actions.set(id, next); return next; }
  async completeVaultSelection(id: string, runId: string, owner: string, result: Record<string, unknown>, envelope: string) {
    const run = memory.runs.get(runId);
    const action = memory.actions.get(id);
    if (run?.userId !== owner || run.status !== "awaiting_approval" || action?.runId !== runId || action.toolName !== "vault_request_item" || action.status !== "proposed") return null;
    const timestamp = now();
    const completed: AgentAction = { ...action, status: "executed", result, approvedBy: owner, approvedAt: timestamp, executedAt: timestamp };
    memory.secrets.set(`${runId}:device_vault:${id}`, envelope);
    memory.actions.set(id, completed);
    return completed;
  }
  async answerQuestionAction(id: string, runId: string, answeredBy: string, result: Record<string, unknown>) {
    const action = await this.getAction(id, runId);
    const run = await this.getRun(runId);
    if (!action || action.toolName !== "ask_questions" || action.status !== "proposed" || run?.status !== "paused") return null;
    const timestamp = now();
    const answered: AgentAction = { ...action, status: "executed", result, approvedBy: answeredBy, approvedAt: timestamp, executedAt: timestamp };
    memory.actions.set(id, answered);
    memory.runs.set(runId, { ...run, status: "running", error: null, updatedAt: timestamp });
    return answered;
  }
  async reopenQuestionAction(id: string, runId: string) {
    const action = await this.getAction(id, runId);
    const run = await this.getRun(runId);
    if (!action || action.toolName !== "ask_questions" || action.status !== "executed" || !run || run.status !== "running") return null;
    const reopened: AgentAction = { ...action, status: "proposed", result: null, approvedBy: null, approvedAt: null, executedAt: null };
    memory.actions.set(id, reopened);
    memory.runs.set(runId, { ...run, status: "paused", error: null, updatedAt: now() });
    return reopened;
  }
  async createArtifact(input: Omit<AgentArtifact, "id" | "createdAt">) { const artifact: AgentArtifact = { ...input, id: crypto.randomUUID(), createdAt: now() }; memory.artifacts.set(artifact.id, artifact); return artifact; }
  async getArtifact(id: string, runId: string) { const artifact = memory.artifacts.get(id); return artifact?.runId === runId ? artifact : null; }
  async putSecret(runId: string, key: string, value: string) { memory.secrets.set(`${runId}:${key}`, value); }
  async putSecrets(runId: string, values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) memory.secrets.set(`${runId}:${key}`, value);
  }
  async getSecret(runId: string, key: string) { return memory.secrets.get(`${runId}:${key}`) ?? null; }
  async getSecrets(runId: string, keys: string[]) {
    return Object.fromEntries(keys.flatMap(key => { const value = memory.secrets.get(`${runId}:${key}`); return value === undefined ? [] : [[key, value]]; }));
  }
  async deleteSecret(runId: string, key: string) { memory.secrets.delete(`${runId}:${key}`); }
  async deleteSecrets(runId: string) { for (const key of memory.secrets.keys()) if (key.startsWith(`${runId}:`)) memory.secrets.delete(key); }
}

// PostgreSQL is the durable production store. The memory store above keeps the
// complete harness runnable locally without infrastructure.
export class PostgresRunStore extends MemoryRunStore {
  override async acceptReply(id: string, message: ModelMessage, patch: Record<string, unknown> = {}): Promise<"started" | "steering" | "busy" | "missing"> {
    return this.sql.begin(async sql => {
      const [row] = await sql`select * from agent_runs where id=${id} for update`;
      if (!row) return "missing" as const;
      const run = this.run(row);
      if (run.status === "paused" && (run.metadata.automaticPause as { ready?: boolean } | undefined)?.ready === false) return "busy" as const;
      if (run.status === "running" || run.status === "planning") {
        const item: AgentMessage = { id: crypto.randomUUID(), runId: id, seq: 0, message, createdAt: now() };
        await sql`update agent_runs set metadata=(metadata || ${sql.json(patch as never)}::jsonb)
          || jsonb_build_object('pendingSteering',coalesce(metadata->'pendingSteering','[]'::jsonb) || ${sql.json([item] as never)}::jsonb),updated_at=now() where id=${id}`;
        return "steering" as const;
      }
      const messages = [...previousResultMessage(run), message];
      // The row lock is already held. Read message sequence numbers in this
      // fresh statement, then publish the messages and running state atomically.
      await sql`with appended as (
        insert into agent_messages(run_id,seq,message)
        select ${id}::uuid,(select coalesce(max(seq),0) from agent_messages where run_id=${id}) + ordinal::integer,entry
        from jsonb_array_elements(${sql.json(messages as never)}::jsonb) with ordinality as entries(entry,ordinal)
        returning id
      ) update agent_runs set status='running',response='',result=null,error=null,completed_at=null,
        metadata=${sql.json({ ...notificationReplyMetadata(run), ...patch } as never)}::jsonb
          || case when ${run.status === 'done' && run.result?.outcome !== 'needs_user'} then jsonb_build_object('completedToolHistorySeq',(select coalesce(max(seq),0) from agent_messages where run_id=${id})) else '{}'::jsonb end,
        updated_at=now() where id=${id}`;
      return "started" as const;
    });
  }
  override async beginManualTakeover(runId: string, owner: string, pageUrl?: string): Promise<AgentAction | null> {
    return this.sql.begin(async sql => {
      const [row] = await sql`select * from agent_runs where id=${runId} and lower(user_id)=lower(${owner}) for update`;
      if (!row) return null;
      const pending = await sql`select * from agent_actions where run_id=${runId} and status='proposed'`;
      const existing = pending.find(action => action.tool_name === "browser_request_takeover" && action.input?.mode !== "wait_for_user");
      if (existing && row.status === "awaiting_approval") return this.action(existing);
      if (row.status !== "running" || pending.some(action => action.risk === "write_external")) return null;
      const args = { manual: true, reason: "You took control of the browser", instructions: "Tap Continue when finished.", ...(pageUrl ? { pageUrl } : {}) };
      const [action] = await sql`insert into agent_actions (run_id,step_id,scope_id,tool_name,risk,preview,input)
        values (${runId},null,${row.metadata?.actionScopeId ?? null},'browser_request_takeover','write_external',
        'You have control of the browser. Tap Continue when you are ready for Dash to resume.',${sql.json(args)}) returning *`;
      await sql`update agent_runs set status='awaiting_approval',updated_at=now(),metadata=metadata || ${sql.json({ manualTakeoverEpoch: action.id, replyTyping: false, toolActivity: null })}::jsonb where id=${runId}`;
      return this.action(action);
    }) as Promise<AgentAction | null>;
  }
  override async withExecutionLock<T>(runId: string, execute: (assertOwned: () => Promise<void>, run?: AgentRun | null) => Promise<T>, options: { loadRun?: boolean } = {}): Promise<{ acquired: false } | { acquired: true; value: T }> {
    // Transaction-scoped locks also work through transaction-pooling proxies.
    // Never expire a lock on a timer while its worker may still be executing.
    return this.sql.begin(async sql => {
      const [row] = options.loadRun
        ? await sql`select pg_try_advisory_xact_lock(hashtextextended(${`agent-execution:${runId}`}, 0)) as acquired,
            (select to_jsonb(r) from agent_runs r where r.id=${runId}) as run`
        : await sql`select pg_try_advisory_xact_lock(hashtextextended(${`agent-execution:${runId}`}, 0)) as acquired`;
      if (!row.acquired) return { acquired: false as const };
      let active = true;
      try {
        const value = await execute(async () => {
          if (!active) throw new Error("Execution lock lost");
          if (options.loadRun) {
            const [current] = await sql`select metadata->>'manualTakeoverEpoch' as epoch from agent_runs where id=${runId}`;
            if ((current?.epoch ?? null) !== (row.run?.metadata?.manualTakeoverEpoch ?? null)) throw new BrowserTakeoverInterrupted();
          } else await sql`select 1`;
        }, options.loadRun ? (row.run ? this.run(row.run as Record<string, unknown>) : null) : undefined);
        return { acquired: true as const, value };
      } finally { active = false; }
    }) as Promise<{ acquired: false } | { acquired: true; value: T }>;
  }
  readonly sql: ReturnType<typeof postgres>;
  private connectionsPrepared?: Promise<void>;
  prepareConnections() {
    // Open the lock and ordinary-query connections while request preparation
    // is still running. Release immediately; never hold a speculative lock.
    return this.connectionsPrepared ??= Promise.all(Array.from({ length: Math.min(2, this.sql.options.max) }, async () => {
      const connection = await this.sql.reserve();
      connection.release();
    })).then(() => undefined).catch(error => {
      this.connectionsPrepared = undefined;
      throw error;
    });
  }
  constructor(url: string, connection = postgres(url, { prepare: false })) { super(); this.sql = connection; }
  private run(row: Record<string, unknown>): AgentRun {
    return { id: String(row.id), userId: String(row.user_id), decisionId: row.decision_id ? String(row.decision_id) : null, category: String(row.category), request: String(row.request), title: String(row.title), response: String(row.response ?? ""), result: (row.result ?? null) as AgentRun["result"], status: row.status as AgentRun["status"], metadata: (row.metadata ?? {}) as Record<string, unknown>, error: row.error ? String(row.error) : null, createdAt: new Date(row.created_at as string).toISOString(), updatedAt: new Date(row.updated_at as string).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null };
  }
  private message(row: Record<string, unknown>): AgentMessage {
    return { id: String(row.id), runId: String(row.run_id), seq: Number(row.seq), message: row.message as ModelMessage, createdAt: new Date(row.created_at as string).toISOString() };
  }
  private action(row: Record<string, unknown>): AgentAction {
    return { id: String(row.id), runId: String(row.run_id), scopeId: row.scope_id ? String(row.scope_id) : null, stepId: row.step_id ? String(row.step_id) : null, toolName: String(row.tool_name), risk: row.risk as AgentAction["risk"], preview: String(row.preview), input: row.input as Record<string, unknown>, result: (row.result ?? null) as Record<string, unknown> | null, status: row.status as AgentAction["status"], createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : undefined, approvedBy: row.approved_by ? String(row.approved_by) : null, approvedAt: row.approved_at ? new Date(row.approved_at as string).toISOString() : null, executedAt: row.executed_at ? new Date(row.executed_at as string).toISOString() : null };
  }
  private artifactMetadata(row: Record<string, unknown>): Omit<AgentArtifact, "bytesBase64"> {
    return { id: String(row.id), runId: String(row.run_id), actionId: row.action_id ? String(row.action_id) : null, name: String(row.name), mimeType: String(row.mime_type), createdAt: new Date(row.created_at as string).toISOString() };
  }
  private artifact(row: Record<string, unknown>): AgentArtifact {
    return { ...this.artifactMetadata(row), bytesBase64: Buffer.from(row.content as Uint8Array).toString("base64") };
  }
  override async createRun(input: Pick<AgentRun, "userId" | "decisionId" | "category" | "request" | "title" | "metadata">, initialMessages?: (run: AgentRun) => ModelMessage[], initialSecrets: Record<string, string> = {}) {
    if (!initialMessages && Object.keys(initialSecrets).length === 0) {
      const [row] = await this.sql`insert into agent_runs (user_id, decision_id, category, request, title, metadata) values (${input.userId}, ${input.decisionId}, ${input.category}, ${input.request}, ${input.title}, ${this.sql.json(input.metadata as never)}) returning *`;
      const created = this.run(row as Record<string, unknown>);

      return created;
    }
    const timestamp = now();
    const run: AgentRun = { ...input, id: crypto.randomUUID(), status: "planning", response: "", result: null, error: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null };
    const messages = initialMessages?.(run) ?? [];
    const secrets = Object.entries(initialSecrets).map(([secret_key, value]) => ({ secret_key, encrypted_value: encryptSecret(value) }));
    const [row] = await this.sql`with created as (
      insert into agent_runs (id,user_id,decision_id,category,request,title,metadata,status)
      values (${run.id},${input.userId},${input.decisionId},${input.category},${input.request},${input.title},${this.sql.json(input.metadata as never)},${messages.length ? "running" : "planning"}) returning *
    ), seeded as (
      insert into agent_messages(run_id,seq,message)
      select created.id,ordinal::integer,entry from created,
        jsonb_array_elements(${this.sql.json(messages as never)}::jsonb) with ordinality as items(entry,ordinal)
    ), credentials as (
      insert into agent_run_secrets(run_id,secret_key,encrypted_value)
      select created.id,s.secret_key,s.encrypted_value from created,
        jsonb_to_recordset(${this.sql.json(secrets as never)}::jsonb) as s(secret_key text,encrypted_value text)
    ) select * from created`;
    const created = this.run(row as Record<string, unknown>);

      return created;
  }
  override async getRun(id: string) { const [row] = await this.sql`select * from agent_runs where id = ${id} limit 1`; return row ? this.run(row as Record<string, unknown>) : null; }
  override async searchOwnedChats(owner: string, query: string, excludeRunId: string, offset: number, limit: number) {
    const rows = await this.sql`select r.* from agent_runs r where lower(r.user_id)=lower(${owner}) and r.id<>${excludeRunId}
      and (${query}='' or strpos(lower(r.title),lower(${query}))>0 or strpos(lower(r.request),lower(${query}))>0 or strpos(lower(r.response),lower(${query}))>0
      or exists (select 1 from agent_messages m where m.run_id=r.id and m.message->>'role' in ('user','assistant') and
        (case when jsonb_typeof(m.message->'content')='string' then strpos(lower(m.message->>'content'),lower(${query}))>0
        when jsonb_typeof(m.message->'content')='array' then exists (select 1 from jsonb_array_elements(m.message->'content') p where p->>'type'='text' and strpos(lower(p->>'text'),lower(${query}))>0) else false end)))
      order by r.updated_at desc,r.id asc offset ${offset} limit ${limit}`;
    return rows.map(row => this.run(row as Record<string, unknown>));
  }

  override async acceptNotificationReply(input: NotificationReplyInput): Promise<NotificationReplyResult | null> {
    return this.sql.begin(async sql => {
      // Serialize first replies to a suggestion before a run row exists.
      if (!input.runId) await sql`select pg_advisory_xact_lock(hashtextextended(${`notification:${input.owner}:${input.decisionId}`},0))`;
      let [row] = input.runId
        ? await sql`select * from agent_runs where id=${input.runId} and user_id=${input.owner} for update`
        : await sql`select * from agent_runs r where decision_id=${input.decisionId ?? ""} and user_id=${input.owner}
          order by (coalesce(metadata->>'initialNotificationReplyId'=${input.eventId},false)
            or exists(select 1 from agent_messages m where m.run_id=r.id and m.message->'providerOptions'->'wdyt'->>'notificationReplyId'=${input.eventId})
            or exists(select 1 from jsonb_array_elements(coalesce(metadata->'pendingSteering','[]'::jsonb)) p where p->'message'->'providerOptions'->'wdyt'->>'notificationReplyId'=${input.eventId})) desc,
            created_at desc limit 1 for update`;
      if (!row && !input.runId && input.decisionId && input.newRun) {
        const seed = input.newRun;
        [row] = await sql`insert into agent_runs(user_id,decision_id,category,request,title,metadata) values
          (${input.owner},${input.decisionId},${seed.category},${seed.request},${seed.title},${sql.json({ ...seed.metadata, initialNotificationReplyId: input.eventId } as never)}) returning *`;
        return { run: this.run(row as Record<string, unknown>), mode: "started" };
      }
      if (!row) return null;
      const run = this.run(row as Record<string, unknown>);
      const [existing] = await sql`select id from agent_messages where run_id=${run.id} and message->'providerOptions'->'wdyt'->>'notificationReplyId'=${input.eventId} limit 1`;
      if (run.metadata.initialNotificationReplyId === input.eventId || existing || pendingSteering(run).some(item => notificationReplyId(item.message) === input.eventId)) return { run, mode: "duplicate" };
      if (run.status === "paused" && (run.metadata.automaticPause as { ready?: boolean } | undefined)?.ready === false) throw new Error("This conversation is resuming. Try again in a moment.");
      const active = ["planning", "running"].includes(run.status);
      const message = notificationReplyMessage(input);
      if (active) {
        const item: AgentMessage = { id: crypto.randomUUID(), runId: run.id, seq: 0, message, createdAt: now() };
        [row] = await sql`update agent_runs set metadata=jsonb_set(metadata,'{pendingSteering}',coalesce(metadata->'pendingSteering','[]'::jsonb) || ${sql.json([item] as never)}::jsonb),updated_at=now() where id=${run.id} returning *`;
      } else {
        const [last] = await sql`select coalesce(max(seq),0) as seq from agent_messages where run_id=${run.id}`;
        let seq = Number(last.seq);
        for (const entry of [...previousResultMessage(run), message]) await sql`insert into agent_messages(run_id,seq,message) values (${run.id},${++seq},${sql.json(entry as never)})`;
        await sql`update agent_actions set status='rejected' where run_id=${run.id} and status in ('proposed','approved') and result->>'executionStartedAt' is null`;
        [row] = await sql`update agent_runs set status='running',result=null,response='',error=null,completed_at=null,metadata=${sql.json({ ...notificationReplyMetadata(run), ...completedToolHistoryPatch(run, Number(last.seq)) } as never)},updated_at=now() where id=${run.id} returning *`;
      }
      return { run: this.run(row as Record<string, unknown>), mode: active ? "steering" : "started" };
    });
  }
  override async acceptReaction(id: string, message: ModelMessage): Promise<"started" | "steering" | "duplicate" | "busy"> {
    const event = reactionOf(message);
    if (!event || message.role !== "user") return "busy";
    return this.sql.begin(async sql => {
      const [row] = await sql`select * from agent_runs where id=${id} for update`;
      if (!row) return "busy";
      const run = this.run(row as Record<string, unknown>);
      const [existing] = await sql`select id from agent_messages where run_id=${id} and message->'providerOptions'->'wdyt'->'reaction'->>'eventId'=${event.eventId} limit 1`;
      if (existing || pendingSteering(run).some(item => reactionOf(item.message)?.eventId === event.eventId)) return "duplicate";
      const queued = pendingSteering(run).filter(item => item.message.role === "user" && reactionOf(item.message)?.messageId === event.messageId).at(-1);
      const [lastReaction] = await sql`select message from agent_messages where run_id=${id} and message->>'role'='user' and message->'providerOptions'->'wdyt'->'reaction'->>'messageId'=${event.messageId} order by seq desc limit 1`;
      const latest = queued?.message ?? lastReaction?.message as ModelMessage | undefined;
      if ((latest ? reactionOf(latest)?.emoji : event.messageId === `${id}:opening` ? run.metadata.initialReaction ?? null : null) === event.emoji) return "duplicate";
      if (run.status === "paused" && (run.metadata.automaticPause as { ready?: boolean } | undefined)?.ready === false) return "busy";
      const active = ["running", "planning"].includes(run.status);
      if (active) {
        const item: AgentMessage = { id: crypto.randomUUID(), runId: id, seq: 0, message, createdAt: now() };
        await sql`update agent_runs set metadata=jsonb_set(metadata,'{pendingSteering}',coalesce(metadata->'pendingSteering','[]'::jsonb) || ${sql.json([item] as never)}::jsonb),updated_at=now() where id=${id}`;
      } else {
        const [last] = await sql`select coalesce(max(seq),0) as seq from agent_messages where run_id=${id}`;
        await sql`insert into agent_messages(run_id,seq,message) values (${id},${Number(last.seq)+1},${sql.json(message as never)})`;
        await sql`update agent_runs set status='running',result=null,response='',error=null,completed_at=null,metadata=(metadata - 'automaticPause' - 'pauseDispatchId') || ${sql.json({ ...newTurnActivityMetadata, ...completedToolHistoryPatch(run, Number(last.seq)) })}::jsonb || jsonb_build_object('reactionResumeStatus',${["paused", "awaiting_approval"].includes(run.status) ? run.status : null}::text),updated_at=now() where id=${id}`;
      }
      return active ? "steering" : "started";
    });
  }
  override async claimRunForReply(id: string) {
    const rows = await this.sql`update agent_runs set status='running',metadata=(metadata - 'automaticPause' - 'pauseDispatchId') || ${this.sql.json(newTurnActivityMetadata)}::jsonb,updated_at=now() where id=${id} and status not in ('planning','running') and (status <> 'paused' or coalesce(metadata->'automaticPause'->>'ready','true') <> 'false') returning id`;
    return rows.length > 0;
  }
  override async enqueueSteering(id: string, message: ModelMessage) {
    const item: AgentMessage = { id: crypto.randomUUID(), runId: id, seq: 0, message, createdAt: now() };
    const rows = await this.sql`update agent_runs set metadata=jsonb_set(metadata, '{pendingSteering}', coalesce(metadata->'pendingSteering','[]'::jsonb) || ${this.sql.json([item] as never)}::jsonb), updated_at=now() where id=${id} and status in ('running','planning') returning id`;
    return rows.length > 0;
  }
  override async consumeSteering(id: string, requireHistory = false) {
    // The common path has no steering. Avoid opening a transaction and taking
    // a row lock just to find that out. The transaction below still rechecks;
    // tool guards and atomic finalization catch input arriving after this read.
    const pending = await this.sql`select 1 from agent_runs where id=${id} and status<>'cancelled'
      and jsonb_array_length(coalesce(metadata->'pendingSteering','[]'::jsonb))>0
      and (${!requireHistory} or exists(select 1 from agent_messages where run_id=${id}))`;
    if (!pending.length) return false;
    return this.sql.begin(async sql => {
      const [row] = await sql`select * from agent_runs where id=${id} for update`;
      if (!row || row.status === "cancelled") return false;
      const pending = pendingSteering(this.run(row as Record<string, unknown>));
      if (!pending.length) return false;
      const [last] = await sql`select coalesce(max(seq),0) as seq from agent_messages where run_id=${id}`;
      let seq = Number(last.seq);
      for (const item of pending) await sql`insert into agent_messages (id,run_id,seq,message,created_at) values (${item.id},${id},${++seq},${sql.json(item.message as never)},${item.createdAt})`;
      const reactionOnly = pending.every(item => reactionOf(item.message));
      if (!reactionOnly) await sql`update agent_actions set status='rejected' where run_id=${id} and status in ('proposed','approved') and result->>'executionStartedAt' is null`;
      await sql`update agent_runs set metadata=metadata || jsonb_build_object('reactionResumeStatus',${reactionOnly && ["paused", "awaiting_approval"].includes(String(row.status)) ? String(row.status) : null}::text) where id=${id}`;
      await sql`update agent_runs set metadata=(metadata - 'automaticPause' - 'pauseDispatchId') || ${sql.json({ ...newTurnActivityMetadata, pendingSteering: [] })}::jsonb, status='running',result=null,response='',error=null,completed_at=null,updated_at=now() where id=${id}`;
      return true;
    });
  }
  override async restoreWaitingIfNoSteering(id: string, status: "paused" | "awaiting_approval") {
    const rows = await this.sql`update agent_runs set status=${status},updated_at=now() where id=${id} and status='running' and jsonb_array_length(coalesce(metadata->'pendingSteering','[]'::jsonb))=0 returning id`;
    return rows.length > 0;
  }
  override async finishRunIfNoSteering(id: string, result: AgentRun["result"], error?: string) {
    const rows = await this.sql`update agent_runs set result=${result === null ? null : this.sql.json(result as never)},status=${error ? "failed" : "done"},error=${error ?? null},completed_at=now(),updated_at=now(),
      metadata=metadata || case when ${!error && result?.outcome !== 'needs_user'} then jsonb_build_object('completedToolHistorySeq',(select coalesce(max(seq),0) from agent_messages where run_id=${id})) else '{}'::jsonb end
      where id=${id} and status='running' and jsonb_array_length(coalesce(metadata->'pendingSteering','[]'::jsonb))=0 and coalesce((metadata->>'runtimeResultSeq')::bigint,0)<=coalesce((metadata->>'runtimeResultReadSeq')::bigint,0) returning *`;

    return rows.length > 0;
  }
  override async acknowledgeRuntimeResults(id: string, throughSeq: number) {
    if (!Number.isSafeInteger(throughSeq) || throughSeq < 0) return;
    await this.sql`update agent_runs set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{runtimeResultReadSeq}',to_jsonb(greatest(coalesce((metadata->>'runtimeResultReadSeq')::bigint,0),${throughSeq}::bigint))) where id=${id}`;
  }
  override async findLatestRun(userId: string, decisionId: string) {
    const [row] = await this.sql`select * from agent_runs where user_id = ${userId} and decision_id = ${decisionId} order by created_at desc limit 1`;
    return row ? this.run(row as Record<string, unknown>) : null;
  }
  override async getSnapshot(id: string): Promise<AgentRunSnapshot | null> {
    const value = await this.readSnapshot(id, false);
    if (!value) return null;
    const { messages: _messages, ...snapshot } = value;
    return snapshot;
  }
  override async getTurnSnapshot(id: string) { return this.readSnapshot(id, true); }
  private async readSnapshot(id: string, includeMessages: boolean): Promise<(AgentRunSnapshot & { messages: AgentMessage[] }) | null> {
    // Read a consistent snapshot in one round trip. Artifact bytes stay out of
    // the aggregate; only getArtifact is allowed to load those potentially large values.
    const [row] = await this.sql`select r.*,
      coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from agent_actions a where a.run_id=r.id),'[]'::jsonb) as snapshot_actions,
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'run_id',a.run_id,'action_id',a.action_id,
        'name',a.name,'mime_type',a.mime_type,'created_at',a.created_at) order by a.created_at)
        from agent_artifacts a where a.run_id=r.id),'[]'::jsonb) as snapshot_artifacts,
      coalesce((select jsonb_agg(ref.value) from agent_messages m cross join lateral
        jsonb_path_query(m.message, '$.providerOptions.wdyt.**.artifactId') ref(value)
        where m.run_id=r.id),'[]'::jsonb) as snapshot_delivered_ids,
      case when ${includeMessages} then coalesce((select jsonb_agg(to_jsonb(m) order by m.seq)
        from agent_messages m where m.run_id=r.id),'[]'::jsonb) else '[]'::jsonb end as snapshot_messages
      from agent_runs r where r.id=${id}`;
    if (!row) return null;
    const run = this.run(row);
    const actions = row.snapshot_actions as Record<string, unknown>[];
    const artifacts = row.snapshot_artifacts as Record<string, unknown>[];
    // Snapshot callers need artifact identities only. Read bytes on demand via getArtifact.
    const latestArtifacts = latestArtifactsByName(artifacts.map((row) => this.artifactMetadata(row as Record<string, unknown>)), row.snapshot_delivered_ids as string[]);
    return { ...run, actions: actions.map((row) => this.action(row as Record<string, unknown>)), artifacts: latestArtifacts,
      messages: (row.snapshot_messages as Record<string, unknown>[]).map(message => this.message(message)) };
  }
  override async setConversationIdentity(id: string, ownerEmail: string, expectedTitle: string, identity: { title: string; category: string }) {
    const patch = this.sql.json(identity as never);
    const [row] = await this.sql`update agent_runs set title=${identity.title}, category=${identity.category}, updated_at=now(),
      metadata=metadata || '{"conversationIdentityGenerated":true}'::jsonb
        || case when jsonb_typeof(metadata->'retryDecision')='object'
          then jsonb_build_object('retryDecision',(metadata->'retryDecision') || ${patch}::jsonb) else '{}'::jsonb end
      where id=${id} and user_id=${ownerEmail} and title=${expectedTitle}
        and metadata->>'initialConversationTitle'=${expectedTitle}
        and coalesce(metadata->>'conversationIdentityGenerated','false') <> 'true'
      returning *`;
    return row ? this.run(row as Record<string, unknown>) : null;
  }

  override async updateRun(id: string, patch: Partial<Pick<AgentRun, "title" | "response" | "result" | "status" | "error" | "completedAt">>) {
    const values: Record<string, unknown> = {};
    for (const field of ["title", "response", "status", "error"] as const) if (field in patch) values[field] = patch[field];
    if ("completedAt" in patch) values.completed_at = patch.completedAt;
    if ("result" in patch) values.result = patch.result === null ? null : this.sql.json(patch.result as never);
    if (!Object.keys(values).length) return this.getRun(id);
    // Patch only the requested columns. A concurrent reminder or cancellation must not be overwritten by a stale read.
    const [row] = await this.sql`update agent_runs set ${this.sql(values as never)}, metadata=case when ${patch.status === 'cancelled'} then metadata - 'automaticPause' - 'pauseDispatchId' else metadata end, updated_at=now() where id=${id} returning *`;
    const updated = row ? this.run(row as Record<string, unknown>) : null;

    return updated;
  }

  override async updateRunMetadata(id: string, patch: Record<string, unknown>, acknowledgeThroughSeq?: number) {
    if (acknowledgeThroughSeq !== undefined && (!Number.isSafeInteger(acknowledgeThroughSeq) || acknowledgeThroughSeq < 0)) throw new Error("Invalid runtime acknowledgement sequence.");
    const [row] = await this.sql`update agent_runs set metadata = coalesce(metadata, '{}'::jsonb) || ${this.sql.json(patch as never)}::jsonb
      || case when ${acknowledgeThroughSeq !== undefined} then jsonb_build_object('runtimeResultReadSeq',
        greatest(coalesce((metadata->>'runtimeResultReadSeq')::bigint,0),${acknowledgeThroughSeq ?? 0}::bigint)) else '{}'::jsonb end,
      updated_at = now() where id = ${id} returning *`;
    return row ? this.run(row as Record<string, unknown>) : null;
  }
  override async hasMessages(runId: string) {
    const rows = await this.sql`select 1 from agent_messages where run_id=${runId} limit 1`;
    return rows.length > 0;
  }
  override async listMessages(runId: string) {
    const rows = await this.sql`select * from agent_messages where run_id = ${runId} order by seq`;
    return rows.map((row) => this.message(row as Record<string, unknown>));
  }
  override async getMessage(id: string, runId: string) {
    const [row] = await this.sql`select * from agent_messages where id=${id} and run_id=${runId}`;
    return row ? this.message(row) : null;
  }
  override async appendMessages(runId: string, messages: ModelMessage[], options?: { finishReplyTyping?: boolean }) {
    if (messages.length === 0) return [];
    return this.sql.begin(async (sql) => {
      await sql`select id from agent_runs where id=${runId} for update`;
      const [last] = await sql`select coalesce(max(seq), 0) as seq from agent_messages where run_id = ${runId}`;
      let seq = Number((last as Record<string, unknown>).seq ?? 0);
      const created: AgentMessage[] = [];
      for (const message of messages) {
        const [row] = await sql`insert into agent_messages (run_id, seq, message) values (${runId}, ${++seq}, ${sql.json(message as never)}) returning *`;
        created.push(this.message(row as Record<string, unknown>));
      }
      if (options?.finishReplyTyping) await sql`update agent_runs set metadata=metadata || '{"replyTyping":false}'::jsonb,updated_at=now() where id=${runId}`;
      return created;
    });
  }
  override async createAction(input: Omit<AgentAction, "id" | "result" | "status" | "approvedBy" | "approvedAt" | "executedAt">) {
    const [row] = await this.sql`insert into agent_actions (run_id, step_id, scope_id, tool_name, risk, preview, input) values (${input.runId}, ${input.stepId}, ${input.scopeId ?? null}, ${input.toolName}, ${input.risk}, ${input.preview}, ${this.sql.json(input.input as never)}) returning *`; return this.action(row as Record<string, unknown>);
  }
  override async findMatchingAction(runId: string, toolName: string, input: Record<string, unknown>, scopeId?: string | null) {
    const rows = await this.sql`select * from agent_actions where run_id = ${runId} and tool_name = ${toolName} and scope_id is not distinct from ${scopeId ?? null} and status not in ('rejected', 'failed') order by created_at desc`;
    const row = rows.find((candidate) => equal((candidate as Record<string, unknown>).input, input)); return row ? this.action(row as Record<string, unknown>) : null;
  }
  override async listExecutedActionsForDecision(userId: string, decisionId: string, toolName?: string) {
    const rows = toolName
      ? await this.sql`select action.* from agent_actions action join agent_runs run on run.id = action.run_id where run.user_id = ${userId} and run.decision_id = ${decisionId} and action.tool_name = ${toolName} and action.status = 'executed' order by action.executed_at desc limit 100`
      : await this.sql`select action.* from agent_actions action join agent_runs run on run.id = action.run_id where run.user_id = ${userId} and run.decision_id = ${decisionId} and action.status = 'executed' order by action.executed_at desc limit 100`;
    return rows.map((row) => this.action(row as Record<string, unknown>));
  }
  override async getAction(id: string, runId: string) { const [row] = await this.sql`select * from agent_actions where id = ${id} and run_id = ${runId} limit 1`; return row ? this.action(row as Record<string, unknown>) : null; }
  override async approveAction(id: string, runId: string, approvedBy: string, emailEdit?: { subject: string; body: string }) { const [row] = await this.sql`update agent_actions set status = 'approved', approved_by = ${approvedBy}, approved_at = now(), result = case when ${Boolean(emailEdit)} then coalesce(result, '{}'::jsonb) || ${this.sql.json(emailEdit ? { approvedEmailEdit: emailEdit } : {})}::jsonb else result end where id = ${id} and run_id = ${runId} and status = 'proposed' and (${!emailEdit} or tool_name in ('gmail_send_draft','icloud_send_email')) returning *`; return row ? this.action(row as Record<string, unknown>) : null; }
  override async rejectPendingActions(runId: string) { await this.sql`update agent_actions set status = 'rejected' where run_id = ${runId} and status = 'proposed'`; }
  override async skipAction(id: string, runId: string, skippedBy: string, result: Record<string, unknown>) {
    const [row] = await this.sql`update agent_actions set status = 'failed', result = ${this.sql.json(result as never)}, approved_by = ${skippedBy}, approved_at = now(), executed_at = now() where id = ${id} and run_id = ${runId} and status = 'proposed' returning *`;
    return row ? this.action(row as Record<string, unknown>) : null;
  }
  override async claimDeviceAction(id: string, runId: string, owner: string, token: string) {
    return this.sql.begin(async sql => {
      const [run] = await sql`select id from agent_runs where id=${runId} and lower(user_id)=lower(${owner}) and status='awaiting_approval' for update`;
      if (!run) return false;
      const [action] = await sql`update agent_actions set status='approved', approved_by=${owner}, approved_at=now() where id=${id} and run_id=${runId} and tool_name='apple_device' and status='proposed' returning id`;
      if (!action) return false;
      await sql`insert into agent_run_secrets(run_id,secret_key,encrypted_value) values (${runId},${`apple_claim:${id}`},${encryptSecret(token)})`;
      return true;
    });
  }
  override async completeDeviceAction(id: string, runId: string, status: "executed" | "failed", result: Record<string, unknown>, message: ModelMessage) {
    return this.sql.begin(async sql => {
      const [run] = await sql`select status from agent_runs where id=${runId} for update`;
      if (!run) return false;
      const [action] = await sql`update agent_actions set status=${status},result=${sql.json(result as never)},executed_at=now() where id=${id} and run_id=${runId} and tool_name='apple_device' and status='approved' returning id`;
      if (!action || ["cancelled", "failed", "done"].includes(String(run.status))) return false;
      const [last] = await sql`select coalesce(max(seq),0) as seq from agent_messages where run_id=${runId}`;
      await sql`insert into agent_messages(run_id,seq,message) values (${runId},${Number(last.seq)+1},${sql.json(message as never)})`;
      await sql`update agent_runs set metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({runtimeResultSeq:Number(last.seq)+1})}::jsonb where id=${runId}`;
      if (run.status !== "awaiting_approval") return false;
      await sql`update agent_runs set status='running',error=null,completed_at=null,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({appleResumePending:id})}::jsonb where id=${runId}`;
      return true;
    });
  }
  override async markActionStarted(id: string) { await this.sql`update agent_actions set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('executionStartedAt', now()) where id = ${id}`; }
  override async completeAction(id: string, status: "executed" | "failed", result: Record<string, unknown>) { const [row] = await this.sql`update agent_actions set status = ${status}, result = ${this.sql.json(result as never)}, executed_at = now() where id = ${id} returning *`; return row ? this.action(row as Record<string, unknown>) : null; }
  override async completeVaultSelection(id: string, runId: string, owner: string, result: Record<string, unknown>, envelope: string) {
    return this.sql.begin(async (sql) => {
      const [run] = await sql`select id from agent_runs where id=${runId} and user_id=${owner} and status='awaiting_approval' for update`;
      if (!run) return null;
      const [row] = await sql`update agent_actions set status='executed', result=${sql.json(result as never)}, approved_by=${owner}, approved_at=now(), executed_at=now() where id=${id} and run_id=${runId} and tool_name='vault_request_item' and status='proposed' returning *`;
      if (!row) return null;
      await sql`insert into agent_run_secrets (run_id, secret_key, encrypted_value) values (${runId}, ${`device_vault:${id}`}, ${encryptSecret(envelope)}) on conflict (run_id, secret_key) do update set encrypted_value=excluded.encrypted_value, updated_at=now()`;
      return this.action(row as Record<string, unknown>);
    });
  }
  override async answerQuestionAction(id: string, runId: string, answeredBy: string, result: Record<string, unknown>) {
    return this.sql.begin(async (sql) => {
      const [row] = await sql`update agent_actions set status = 'executed', result = ${sql.json(result as never)}, approved_by = ${answeredBy}, approved_at = now(), executed_at = now() where id = ${id} and run_id = ${runId} and tool_name = 'ask_questions' and status = 'proposed' returning *`;
      if (!row) return null;
      const [run] = await sql`update agent_runs set status = 'running', error = null, updated_at = now() where id = ${runId} and status = 'paused' returning id`;
      if (!run) throw new Error("Run is no longer waiting for question answers.");
      return this.action(row as Record<string, unknown>);
    });
  }
  override async reopenQuestionAction(id: string, runId: string) {
    return this.sql.begin(async (sql) => {
      const [row] = await sql`update agent_actions set status = 'proposed', result = null, approved_by = null, approved_at = null, executed_at = null where id = ${id} and run_id = ${runId} and tool_name = 'ask_questions' and status = 'executed' returning *`;
      if (!row) return null;
      await sql`update agent_runs set status = 'paused', error = null, updated_at = now() where id = ${runId} and status = 'running'`;
      return this.action(row as Record<string, unknown>);
    });
  }
  override async createArtifact(input: Omit<AgentArtifact, "id" | "createdAt">) { const bytes = Buffer.from(input.bytesBase64, "base64"); const [row] = await this.sql`insert into agent_artifacts (run_id, action_id, name, mime_type, content) values (${input.runId}, ${input.actionId}, ${input.name}, ${input.mimeType}, ${bytes}) returning *`; return this.artifact(row as Record<string, unknown>); }
  override async getArtifact(id: string, runId: string) { const [row] = await this.sql`select * from agent_artifacts where id = ${id} and run_id = ${runId} limit 1`; return row ? this.artifact(row as Record<string, unknown>) : null; }
  override async putSecret(runId: string, key: string, value: string) { await this.sql`insert into agent_run_secrets (run_id, secret_key, encrypted_value) values (${runId}, ${key}, ${encryptSecret(value)}) on conflict (run_id, secret_key) do update set encrypted_value = excluded.encrypted_value, updated_at = now()`; }
  override async putSecrets(runId: string, values: Record<string, string>) {
    const rows = Object.entries(values).map(([key, value]) => ({ run_id: runId, secret_key: key, encrypted_value: encryptSecret(value) }));
    if (!rows.length) return;
    await this.sql`insert into agent_run_secrets ${this.sql(rows)} on conflict (run_id, secret_key) do update set encrypted_value=excluded.encrypted_value,updated_at=now()`;
  }
  override async getSecret(runId: string, key: string) { const [row] = await this.sql`select encrypted_value from agent_run_secrets where run_id = ${runId} and secret_key = ${key} limit 1`; return row ? decryptSecret(String((row as Record<string, unknown>).encrypted_value)) : null; }
  override async getSecrets(runId: string, keys: string[]) {
    if (!keys.length) return {};
    const rows = await this.sql`select secret_key, encrypted_value from agent_run_secrets where run_id=${runId} and secret_key in ${this.sql(keys)}`;
    return Object.fromEntries(rows.map(row => [String(row.secret_key), decryptSecret(String(row.encrypted_value))]));
  }
  override async deleteSecret(runId: string, key: string) { await this.sql`delete from agent_run_secrets where run_id = ${runId} and secret_key = ${key}`; }
  override async deleteSecrets(runId: string) { await this.sql`delete from agent_run_secrets where run_id = ${runId}`; }
}

let selectedStore: RunStore | undefined;
export function getRunStore(): RunStore {
  if (!selectedStore) selectedStore = timedRunStore(process.env.DATABASE_URL ? new PostgresRunStore(process.env.DATABASE_URL) : new MemoryRunStore());
  return selectedStore;
}

export function deleteMemoryRunsForUser(userIdInput: string) {
  const userId = userIdInput.trim().toLowerCase();
  const runIds = new Set([...memory.runs.values()].filter((run) => run.userId.trim().toLowerCase() === userId).map((run) => run.id));
  for (const runId of runIds) memory.runs.delete(runId);
  for (const [id, message] of memory.messages) if (runIds.has(message.runId)) memory.messages.delete(id);
  for (const [id, action] of memory.actions) if (runIds.has(action.runId)) memory.actions.delete(id);
  for (const [id, artifact] of memory.artifacts) if (runIds.has(artifact.runId)) memory.artifacts.delete(id);
  for (const key of memory.secrets.keys()) if ([...runIds].some((runId) => key.startsWith(`${runId}:`))) memory.secrets.delete(key);
  return runIds.size;
}
