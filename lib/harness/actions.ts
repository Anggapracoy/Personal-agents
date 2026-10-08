import { browserApprovalIdentity, BrowserPreDispatchError } from "./browser/approval";
import { assertExecutionOwnership } from "./execution-lock";
import { pendingSteering } from "./steering";
import type { AgentAction, RunStore, ToolRisk } from "./types";
import { sensitiveApprovalCategoryForAction } from "../approval-preferences";

export class ApprovalRequiredError extends Error {
  constructor(readonly action: AgentAction) {
    super(action.toolName === "apple_device"
      ? `Paused for iPhone execution (${action.preview.split("\n")[0]}). Stop this turn now; the runtime resumes with the device result. Connected sources run automatically; the user is prompted only if connection or recovery is needed.`
      : `Paused: waiting for the user (${action.preview.split("\n")[0]}). Stop this turn now; the runtime resumes the thread when they respond.`);
    this.name = "ApprovalRequiredError";
  }
}

export class RunStoppedError extends Error {
  constructor() { super("Agent run is no longer active"); this.name = "RunStoppedError"; }
}

export function isApprovalRequired(error: unknown): error is ApprovalRequiredError {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof ApprovalRequiredError) return true;
    if (!current || typeof current !== "object" || !("cause" in current)) return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function normalizedReceiptValue(value: unknown, key = ""): unknown {
  if (value === undefined) return undefined;
  if (/^(?:requestId|conferenceRequestId|idempotencyKey|nonce)$/i.test(key)) return undefined;
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizedReceiptValue(item)).filter((item) => item !== undefined);
    if (/^(?:to|cc|bcc|attendees)$/i.test(key)) return normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return normalized;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([childKey, childValue]) => [childKey, normalizedReceiptValue(childValue, childKey)])
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined));
  }
  return typeof value === "string" && /^(?:to|cc|bcc|email)$/i.test(key) ? value.trim().toLowerCase() : value;
}

export function durableActionReceiptKey(toolName: string, args: Record<string, unknown>) {
  let identity: unknown = args;
  if (toolName === "calendar_create_event") {
    const event = args.event && typeof args.event === "object" ? args.event as Record<string, unknown> : {};
    identity = {
      summary: event.summary,
      start: event.start,
      end: event.end,
      location: event.location,
      attendees: event.attendees,
    };
  }
  if (toolName === "gmail_create_draft") {
    identity = {
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      threadId: args.threadId,
      replyToMessageId: args.replyToMessageId,
    };
  }
  return JSON.stringify(normalizedReceiptValue(identity));
}

export async function executeGuardedAction(input: {
  runId: string;
  stepId?: string | null;
  toolName: string;
  risk: ToolRisk;
  preview: string;
  args: Record<string, unknown>;
  store: RunStore;
  authorization?: "explicit" | "selected_option";
  alwaysApproved?: boolean;
  dedupeAcrossSteps?: boolean;
  /** Routine browser interactions must execute against current state, not replay a cached click. External writes always deduplicate. */
  deduplicate?: boolean;
  signal?: AbortSignal;
  execute(args: Record<string, unknown>, action: AgentAction): Promise<Record<string, unknown>>;
}) {
  if (input.signal?.aborted) throw new RunStoppedError();
  const run = await input.store.getRun(input.runId);
  if (!run || ["cancelled", "failed", "done", "paused", "awaiting_approval"].includes(run.status)) throw new RunStoppedError();
  const scopeId = typeof run.metadata.actionScopeId === "string" ? run.metadata.actionScopeId : null;
  // Reads must remain live. Reusing an earlier browser_open, inspect, API GET,
  // or screenshot result can return stale evidence and can leave the browser on
  // a different page than the model believes. Reversible/external actions stay
  // deduplicated so durable resume cannot repeat form edits or mutations.
  let action = input.risk === "read" || (input.risk !== "write_external" && input.deduplicate === false) ? null : await input.store.findMatchingAction(input.runId, input.toolName, input.args, scopeId);
  const browserIdentity = input.risk === "write_external" ? browserApprovalIdentity(input.toolName, input.args) : null;
  let retryApproval: AgentAction | undefined;
  if (!action && browserIdentity) {
    const snapshot = await input.store.getSnapshot(input.runId);
    const prior = snapshot?.actions.findLast(candidate => (candidate.scopeId ?? null) === scopeId && browserApprovalIdentity(candidate.toolName, candidate.input) === browserIdentity);
    if (prior?.status === "failed" && prior.approvedBy && prior.result?.inputDispatched === false) retryApproval = prior;
    else if (prior?.status === "failed" || prior?.status === "rejected") throw new Error("This approved browser action failed or was declined. Verify its outcome before requesting or attempting the same submission again.");
    else if (prior) action = prior;
  }
  // Reversible work is idempotent only while resuming the same plan step. A
  // later step may intentionally repeat the same form edit or sandbox command
  // to verify/recreate its own evidence. External writes remain deduplicated
  // across the whole run so a send, payment, or submission cannot repeat.
  if (action && input.risk === "write_reversible" && action.stepId !== (input.stepId ?? null) && !input.dedupeAcrossSteps) action = null;
  let reusedAction: AgentAction | null = null;
  if (!action && run.decisionId && (input.risk === "write_external" || input.dedupeAcrossSteps)) {
    const receiptKey = durableActionReceiptKey(input.toolName, input.args);
    const candidates = await input.store.listExecutedActionsForDecision(run.userId, run.decisionId, input.toolName);
    reusedAction = candidates.find((candidate) => candidate.runId !== input.runId && (candidate.scopeId ?? null) === scopeId && durableActionReceiptKey(candidate.toolName, candidate.input) === receiptKey) ?? null;
  }
  if (reusedAction) {
    action = await input.store.createAction({ runId: input.runId, scopeId, stepId: input.stepId ?? null, toolName: input.toolName, risk: input.risk, preview: input.preview, input: input.args });
    if (input.risk === "write_external") {
      if (!reusedAction.approvedBy) throw new Error("Reused external action is missing its original approver audit record");
      action = await input.store.approveAction(action.id, input.runId, reusedAction.approvedBy) ?? action;
    }
    const reusedResult = {
      ...(reusedAction.result ?? {}),
      $reusedFromActionId: reusedAction.id,
      $reusedFromRunId: reusedAction.runId,
      ...(input.stepId ? { $reusedForStepIds: [input.stepId] } : {}),
    };
    await input.store.completeAction(action.id, "executed", reusedResult);
    return reusedResult;
  }
  if (!action) action = await input.store.createAction({ runId: input.runId, scopeId, stepId: input.stepId ?? null, toolName: input.toolName, risk: input.risk, preview: input.preview, input: input.args });
  if (retryApproval?.approvedBy && action.status === "proposed") {
    action = await input.store.approveAction(action.id, input.runId, retryApproval.approvedBy) ?? action;
  }
  if (action.status === "executed") {
    if (input.risk === "write_external" && !action.approvedBy) throw new Error("External action is missing its approver audit record");
    const result = action.result ?? {};
    if ((input.risk === "write_external" || input.dedupeAcrossSteps) && input.stepId && action.stepId !== input.stepId) {
      const priorStepIds = Array.isArray(result.$reusedForStepIds) ? result.$reusedForStepIds.filter((value): value is string => typeof value === "string") : [];
      if (!priorStepIds.includes(input.stepId)) {
        const linkedResult = { ...result, $reusedForStepIds: [...priorStepIds, input.stepId] };
        await input.store.completeAction(action.id, "executed", linkedResult);
        return linkedResult;
      }
    }
    return result;
  }
  if (input.risk === "write_external" && action.result?.executionStartedAt) {
    throw new Error("This external action started before an interrupted execution, but its outcome was not saved. Do not repeat it. Inspect the external source to establish whether it succeeded; use a different authorized next step only after verifying the outcome.");
  }
  const sensitiveCategory = sensitiveApprovalCategoryForAction(input.toolName, input.args);
  // A client card selection is task context, not approval for arbitrary tool arguments.
  // Generic API semantics cannot be established from a model-written summary.
  const persistentSensitiveApproval = Boolean(input.toolName !== "external_api_action" && sensitiveCategory && input.alwaysApproved);
  // These are user-input handoffs, not external-action confirmation dialogs.
  const userInputHandoff = ["connector_request_connection", "vault_request_item", "browser_request_signin", "browser_request_takeover", "ask_questions", "apple_device"].includes(input.toolName);
  const requiresConfirmation = sensitiveCategory !== null || ["email_send", "purchase"].includes(String(input.args.approvalCategory)) || ["purchase", "bill_payment", "transfer", "payment"].includes(String(input.args.approvalType));
  const automaticExecution = input.risk === "write_external" && !requiresConfirmation && !userInputHandoff;
  if ((persistentSensitiveApproval || automaticExecution) && action.status === "proposed") {
    action = await input.store.approveAction(action.id, input.runId, run.userId) ?? action;
  }
  if (input.risk === "write_external" && action.status !== "approved") {
    await input.store.updateRun(input.runId, { status: "awaiting_approval" });
    throw new ApprovalRequiredError(action);
  }
  if (input.risk === "write_external" && !action.approvedBy) throw new Error("External action is missing its approver audit record");
  if (input.signal?.aborted) throw new RunStoppedError();
  if (pendingSteering(await input.store.getRun(input.runId)).length) throw new Error("New user input is pending. Yield to steering before executing this action.");
  await input.store.updateRunMetadata(input.runId, { currentActivityActionId: action.id, taskWorkStarted: true });
  try {
    await assertExecutionOwnership();
    if (input.risk === "write_external") await input.store.markActionStarted(action.id);
    const result = await input.execute(action.input, action);
    await input.store.completeAction(action.id, result.$toolError === true ? "failed" : "executed", result);
    return result;
  } catch (error) {
    await input.store.completeAction(action.id, "failed", { error: error instanceof Error ? error.message : "Tool execution failed", ...(error instanceof BrowserPreDispatchError ? { inputDispatched: false } : {}) });
    throw error;
  }
}

// Device-vault fills are reversible browser edits, but they must always pause
// until the user's phone has unlocked and released a one-time encrypted
// envelope. Unlike an external-action approval, this gate can never be
// satisfied implicitly by the decision-card choice.
/** These failures occur before secret input is dispatched; they require new consent. */
export function isExpiredDeviceVaultRelease(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /The one-time device vault recipient has expired|The vault approval belongs to a different browser session|The vault recipient belongs to a different browser tab|The device unlock is unavailable\. Unlock this saved item on your iPhone to continue\./.test(message);
}

export async function executeDeviceVaultAction(input: {
  runId: string;
  stepId?: string | null;
  toolName: "vault_fill_login" | "vault_fill_payment";
  preview: string;
  args: Record<string, unknown>;
  dedupeKey?: string;
  repeatedFailureMessage?: string;
  store: RunStore;
  signal?: AbortSignal;
  execute(args: Record<string, unknown>, action: AgentAction): Promise<Record<string, unknown>>;
}) {
  if (input.signal?.aborted) throw new RunStoppedError();
  const run = await input.store.getRun(input.runId);
  if (!run || ["cancelled", "failed", "done", "paused", "awaiting_approval"].includes(run.status)) throw new RunStoppedError();
  const scopeId = typeof run.metadata.actionScopeId === "string" ? run.metadata.actionScopeId : null;
  let action: AgentAction | null = null;
  if (input.dedupeKey) {
    const snapshot = await input.store.getSnapshot(input.runId);
    const prior = [...(snapshot?.actions ?? [])].reverse().find((candidate) =>
      candidate.toolName === input.toolName &&
      (candidate.scopeId ?? null) === scopeId &&
      candidate.input.dedupeKey === input.dedupeKey &&
      candidate.status !== "rejected"
    ) ?? null;
    if (prior?.status === "failed" && !isExpiredDeviceVaultRelease(prior.result?.error)) {
      throw new Error(input.repeatedFailureMessage ?? "This secure vault fill already failed on the unchanged page. Do not request another unlock; use the supported manual fallback.");
    }
    if (prior?.status === "failed") await input.store.deleteSecret(input.runId, `device_vault:${prior.id}`);
    action = prior?.status === "failed" ? null : prior;
  }
  action ??= await input.store.findMatchingAction(input.runId, input.toolName, input.args, scopeId);
  // A paused single-field request resumes against the exact approved target.
  // Later fields are separate actions that can reuse the original encrypted
  // release; deduplication must never replace typing a different field.
  if (action && !input.dedupeKey && action.stepId !== (input.stepId ?? null)) action = null;
  if (!action) action = await input.store.createAction({
    runId: input.runId,
    scopeId,
    stepId: input.stepId ?? null,
    toolName: input.toolName,
    risk: "write_reversible",
    preview: input.preview,
    input: input.args,
  });
  if (action.status === "executed") return action.result ?? {};
  if (action.status !== "approved") {
    await input.store.updateRun(input.runId, { status: "awaiting_approval" });
    throw new ApprovalRequiredError(action);
  }
  if (!action.approvedBy) throw new Error("Device vault release is missing its approver audit record");
  if (input.signal?.aborted) throw new RunStoppedError();
  if (pendingSteering(await input.store.getRun(input.runId)).length) throw new Error("New user input is pending. Yield to steering before executing this action.");
  await input.store.updateRunMetadata(input.runId, { currentActivityActionId: action.id, taskWorkStarted: true });
  try {
    await assertExecutionOwnership();
    const result = await input.execute(action.input, action);
    await input.store.completeAction(action.id, result.$toolError === true ? "failed" : "executed", result);
    return result;
  } catch (error) {
    await input.store.completeAction(action.id, "failed", { error: error instanceof Error ? error.message : "Device vault fill failed" });
    if (isExpiredDeviceVaultRelease(error)) {
      await input.store.deleteSecret(input.runId, `device_vault:${action.id}`);
      const current = await input.store.getRun(input.runId);
      if (!input.signal?.aborted && current?.status === "running" && !pendingSteering(current).length) {
        // The caller just obtained a recipient for the current browser. Never
        // transfer the old approval onto this new encrypted release.
        const fresh = await input.store.createAction({ runId: input.runId, scopeId, stepId: input.stepId ?? null,
          toolName: input.toolName, risk: "write_reversible", preview: input.preview, input: input.args });
        await input.store.updateRun(input.runId, { status: "awaiting_approval" });
        throw new ApprovalRequiredError(fresh);
      }
    }
    throw error;
  }
}

const EXTERNAL_PATTERNS = /send|submit|purchase|checkout|pay|charge|refund|book|reserve|cancel|renew|subscribe|accept|approve|authorize|delete|remove|publish|post|invite|calendar.*(?:create|update)|(?:create|update).*calendar|message.*create/i;
const READ_PATTERNS = /(?:^|__|_)(?:search|list|get|read|find|fetch|lookup|weather|price|availability|status)(?:_|$)/i;
const REVERSIBLE_PATTERNS = /draft|upload|sandbox|write_file|type|select|check/i;
export function classifyToolRisk(name: string): ToolRisk {
  if (EXTERNAL_PATTERNS.test(name)) return "write_external";
  if (READ_PATTERNS.test(name)) return "read";
  if (REVERSIBLE_PATTERNS.test(name)) return "write_reversible";
  return "write_external";
}
