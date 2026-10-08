import type { ModelMessage } from "ai";
import type { ResultBlock } from "./result-blocks";

type RunStatus = "planning" | "running" | "awaiting_approval" | "paused" | "done" | "failed" | "cancelled";
type ActionStatus = "proposed" | "approved" | "rejected" | "executed" | "failed";
export type ToolRisk = "read" | "write_reversible" | "write_external";

export type AgentFollowUpAction = {
  id: string;
  label: string;
  description: string;
  intent: string;
  actionType: "approval" | "research" | "instant";
  optionId: string | null;
  sourceUrl: string | null;
  requiresFreshEvidence: boolean;
};

export type AgentResult = {
  outcome: "completed" | "no_action" | "needs_user";
  summary: string;
  details: string;
  verified: boolean;
  externalChange: boolean;
  options?: Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    sourceUrl: string | null;
    recommended: boolean;
  }>;
  followUpActions?: AgentFollowUpAction[];
  blocks?: ResultBlock[];
  blocksOnly?: boolean;
  leadIn?: string;
  blocksMessageId?: string;
  facts: Array<{ label: string; value: string; sourceUrl: string | null }>;
  links: Array<{ label: string; url: string }>;
  moneySaved: null | {
    amount: number;
    currency: string;
    cadence: "one_time" | "monthly" | "annual";
    basis: string;
  };
  recommendedNextStep: string | null;
};

/**
 * A run is one durable conversation thread between the user and the agent.
 * `request` is the first user turn; later turns live in the message log.
 */
export type AgentRun = {
  id: string;
  userId: string;
  decisionId: string | null;
  category: string;
  request: string;
  title: string;
  response: string;
  result: AgentResult | null;
  status: RunStatus;
  metadata: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

/** One item of the thread, in AI SDK `ModelMessage` shape. `seq` orders the log. */
export type AgentMessage = {
  id: string;
  runId: string;
  seq: number;
  message: ModelMessage;
  createdAt: string;
};

export type AgentAction = {
  /** Distinct scheduled occurrence; retries and approvals keep the same scope. */
  scopeId?: string | null;
  id: string;
  runId: string;
  /** The dispatch turn this action belongs to. Reversible work dedupes within a turn; external writes across the run. */
  stepId: string | null;
  toolName: string;
  risk: ToolRisk;
  preview: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  status: ActionStatus;
  /** Original request time, including unanswered or superseded actions. */
  createdAt?: string;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
};

export type AgentArtifact = {
  id: string;
  runId: string;
  actionId: string | null;
  name: string;
  mimeType: string;
  bytesBase64: string;
  createdAt: string;
};

export type AgentRunSnapshot = AgentRun & {
  /** Included by live delivery so message arrival and typing share one render. */
  threadItems?: import("./thread").ThreadItem[];
  actions: AgentAction[];
  artifacts: Omit<AgentArtifact, "bytesBase64">[];
};

export type RunStore = {
  prepareConnections?: () => Promise<void>;
  beginManualTakeover(runId: string, owner: string, pageUrl?: string): Promise<AgentAction | null>;
  acceptReply(id: string, message: ModelMessage, metadata?: Record<string, unknown>): Promise<"started" | "steering" | "busy" | "missing">;
  withExecutionLock<T>(runId: string, execute: (assertOwned: () => Promise<void>, run?: AgentRun | null) => Promise<T>, options?: { loadRun?: boolean }): Promise<{ acquired: false } | { acquired: true; value: T }>;
  createRun(input: Pick<AgentRun, "userId" | "decisionId" | "category" | "request" | "title" | "metadata">, initialMessages?: (run: AgentRun) => ModelMessage[], initialSecrets?: Record<string, string>): Promise<AgentRun>;
  getRun(id: string): Promise<AgentRun | null>;
  searchOwnedChats(owner: string, query: string, excludeRunId: string, offset: number, limit: number): Promise<AgentRun[]>;
  acceptNotificationReply(input: import("./notification-reply").NotificationReplyInput): Promise<import("./notification-reply").NotificationReplyResult | null>;
  acceptReaction(id: string, message: ModelMessage): Promise<"started" | "steering" | "duplicate" | "busy">;
  claimRunForReply(id: string): Promise<boolean>;
  enqueueSteering(id: string, message: ModelMessage): Promise<boolean>;
  consumeSteering(id: string, requireHistory?: boolean): Promise<boolean>;
  restoreWaitingIfNoSteering(id: string, status: "paused" | "awaiting_approval"): Promise<boolean>;
  acknowledgeRuntimeResults(id: string, throughSeq: number): Promise<void>;
  finishRunIfNoSteering(id: string, result: AgentResult | null, error?: string): Promise<boolean>;
  findLatestRun(userId: string, decisionId: string): Promise<AgentRun | null>;
  getSnapshot(id: string): Promise<AgentRunSnapshot | null>;
  getTurnSnapshot(id: string): Promise<(AgentRunSnapshot & { messages: AgentMessage[] }) | null>;
  setConversationIdentity(id: string, ownerEmail: string, expectedTitle: string, identity: { title: string; category: string }): Promise<AgentRun | null>;
  updateRun(id: string, patch: Partial<Pick<AgentRun, "title" | "response" | "result" | "status" | "error" | "completedAt">>): Promise<AgentRun | null>;
  updateRunMetadata(id: string, patch: Record<string, unknown>, acknowledgeThroughSeq?: number): Promise<AgentRun | null>;
  listMessages(runId: string): Promise<AgentMessage[]>;
  getMessage(id: string, runId: string): Promise<AgentMessage | null>;
  hasMessages(runId: string): Promise<boolean>;
  appendMessages(runId: string, messages: ModelMessage[], options?: { finishReplyTyping?: boolean }): Promise<AgentMessage[]>;
  createAction(input: Omit<AgentAction, "id" | "result" | "status" | "approvedBy" | "approvedAt" | "executedAt">): Promise<AgentAction>;
  findMatchingAction(runId: string, toolName: string, input: Record<string, unknown>, scopeId?: string | null): Promise<AgentAction | null>;
  listExecutedActionsForDecision(userId: string, decisionId: string, toolName?: string): Promise<AgentAction[]>;
  getAction(id: string, runId: string): Promise<AgentAction | null>;
  approveAction(id: string, runId: string, approvedBy: string, emailEdit?: { subject: string; body: string }): Promise<AgentAction | null>;
  rejectPendingActions(runId: string): Promise<void>;
  skipAction(id: string, runId: string, skippedBy: string, result: Record<string, unknown>): Promise<AgentAction | null>;
  claimDeviceAction(id: string, runId: string, owner: string, token: string): Promise<boolean>;
  completeDeviceAction(id: string, runId: string, status: "executed" | "failed", result: Record<string, unknown>, message: ModelMessage): Promise<boolean>;
  markActionStarted(id: string): Promise<void>;
  completeAction(id: string, status: "executed" | "failed", result: Record<string, unknown>): Promise<AgentAction | null>;
  completeVaultSelection(id: string, runId: string, owner: string, result: Record<string, unknown>, envelope: string): Promise<AgentAction | null>;
  answerQuestionAction(id: string, runId: string, answeredBy: string, result: Record<string, unknown>): Promise<AgentAction | null>;
  reopenQuestionAction(id: string, runId: string): Promise<AgentAction | null>;
  createArtifact(input: Omit<AgentArtifact, "id" | "createdAt">): Promise<AgentArtifact>;
  getArtifact(id: string, runId: string): Promise<AgentArtifact | null>;
  putSecret(runId: string, key: string, value: string): Promise<void>;
  putSecrets(runId: string, values: Record<string, string>): Promise<void>;
  getSecret(runId: string, key: string): Promise<string | null>;
  getSecrets(runId: string, keys: string[]): Promise<Record<string, string>>;
  deleteSecret(runId: string, key: string): Promise<void>;
  deleteSecrets(runId: string): Promise<void>;
};

/** One model turn over the whole thread: the loop runs until the model stops calling tools or a pause tool suspends the run. */
export type AgentModel = {
  /** Start read-only context loading after the worker has verified the run. */
  prepare?(run: AgentRun): void;
  turn(input: { run: AgentRun; turnId: string; signal?: AbortSignal; onNarration(delta: string): Promise<void> }): Promise<void>;
  dispose?(): Promise<void>;
};
