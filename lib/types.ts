import type { AgentResult } from "./harness/types";
import type { AgentQuestion } from "./harness/questions";

export type Category = "schedule" | "money" | "food" | "family" | "shopping" | "travel" | "social";
type Urgency = "high" | "medium" | "low";
type ActionType = "instant" | "approval" | "research" | "link" | "no_action";

export type DecisionOption = {
  id: string;
  label: string;
  sublabel?: string;
  actionType: ActionType;
  isPrimary?: boolean;
};

export type SourceAttachment = { id: string; name: string; mimeType: string; size: number };

export type DecisionExecutionContext = {
  sourceAccountId?: string;
  sourceAccountEmail?: string;
  emailProvider?: "google" | "icloud";
  sourceEmail?: {
    messageId: string;
    threadId: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    snippet: string;
    body: string;
    links: string[];
    confirmationNumbers: string[];
    attachments: SourceAttachment[];
  };
  sourceCalendar?: {
    sourceKind?: "google" | "device";
    eventIds: string[];
    events: Array<{
      id: string;
      summary: string;
      description: string;
      location: string;
      start: string;
      end: string;
      attendees: string[];
      htmlLink: string;
    }>;
  };
  sharedIntake?: {
    intakeId: string;
    text: string;
    url?: string;
    files: Array<{ name: string; mimeType: string; size: number }>;
  };
  followUp?: {
    parentRunId?: string;
    parentHistoryEntryId: string;
    parentTitle: string;
    selectedOption?: { id: string; name: string; description: string; status: string; sourceUrl: string | null };
    action: { id: string; label: string; description: string; intent: string; sourceUrl: string | null; requiresFreshEvidence: boolean };
  };
};

export type Decision = {
  id: string;
  discoveryFingerprint?: string;
  discoveryUpdatesDecisionId?: string;
  discoveryUpdateKey?: string;
  sourceType: "email" | "calendar" | "recurring" | "manual" | "proactive";
  category: Category;
  urgency: Urgency;
  title: string;
  subtitle: string;
  /** Presentation only: the object icon the planner chose. Falls back to category. */
  iconKind?: string;
  sourceLabel?: string;
  whyThisAppeared?: string[];
  evidence?: Array<{
    claim: string;
    sourceType: "email" | "calendar" | "weather" | "profile" | "route" | "account" | "calculation";
    sourceLabel: string;
    sourceId?: string;
  }>;
  originalContext: string;
  executionContext?: DecisionExecutionContext;
  options: DecisionOption[];
  dismissLabel: string;
  createdAt: string;
  /** Verified last useful moment for the card's primary action. */
  actionableUntil?: string;
  activeRunId?: string;
  selectedOption?: string;
  result?: AgentResult;
  runArtifacts?: Array<{ id: string; runId: string; name: string; mimeType: string }>;
};

export type RunningTask = {
  activityAt?: string;
  activity?: import("./harness/tool-activity-icons").ToolActivity;
  id: string;
  decisionId: string;
  category: Category;
  title: string;
  subtitle: string;
  status: "running" | "waiting" | "needs_approval" | "failed";
  automaticPause?: import("./pauses/definition").PauseDisplay;
  estimate?: string;
  /** Last meaningful server-side activity, for freshness copy on the task screen. */
  updatedAt?: string;
  draft?: string;
  chosenOption: string;
  originalContext: string;
  runId?: string;
  actionId?: string;
  nativeAction?: { readOnly: boolean; operation: string; parameters: Record<string, unknown> };
  approvalKind?: "connector" | "external" | "email_send" | "purchase" | "takeover" | "signin" | "reconnect" | "vault_login" | "vault_payment" | "questions";
  approvalRequest?: {
    toolkit?: string;
    appName?: string;
    appLogo?: string;
    mode?: "browser" | "wait_for_user";
    siteHost?: string;
    suggestedLabel?: string;
    reason?: string;
    needSecurityCode?: boolean;
    deviceRelease?: boolean;
    itemId?: string;
    kind?: "login" | "payment_card";
    recipientPublicKey?: string;
    to?: string[];
    subject?: string;
    body?: string;
    pageUrl?: string;
    purpose?: string;
    controlLabel?: string;
    approvalType?: "purchase" | "bill_payment" | "transfer" | "payment";
  };
  questionRequest?: { questions: AgentQuestion[] };
  browserFrames?: Array<{ id: string; actionId: string; label: string; url?: string; createdAt: string }>;
  /** True when the durable action log contains browser work, even if replay capture failed. */
  browserUsed?: boolean;
  /** Original feed card, retained so a failed run can restore its real choices. */
  retryDecision?: Decision;
};

export type HistoryEntry = {
  activityAt?: string;
  messageReactions?: Record<string, import("./harness/reactions").MessageReaction[]>;
  choiceAcknowledgment?: "👍";
  responseDisposition?: "silent" | "reaction" | "text";
  id: string;
  runId?: string;
  decisionId?: string;
  category: Category;
  title: string;
  subtitle: string;
  time: string;
  /** Actual completion time used to derive the History day heading. */
  completedAt?: string;
  /** Legacy cached bucket retained for older saved workspaces. */
  group: "TODAY" | "YESTERDAY" | "LAST WEEK";
  status: "done" | "saved" | "dismissed" | "failed";
  originalContext: string;
  /** Short consumer-facing explanation. originalContext remains internal evidence. */
  contextSummary?: string;
  chosenOption: string;
  steps: string[];
  outcome: string;
  messageSent?: string;
  moneySaved?: NonNullable<AgentResult["moneySaved"]> | number;
  caught?: boolean;
  result?: AgentResult;
  retryDecision?: Decision;
  artifacts?: Array<{ id: string; runId: string; name: string; mimeType: string }>;
};

export type WorkspaceAppearance = "system" | "light" | "dark";
export type WorkspaceReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type WorkspaceModelSettings = {
  provider: "anthropic" | "openai" | "meta" | "google";
  modelId: string;
  reasoningEffort: WorkspaceReasoningEffort;
  defaultVersion?: number;
};

export type WorkspaceStateData = {
  decisions: Decision[];
  tasks: RunningTask[];
  history: HistoryEntry[];
  discardedDecisionIds: string[];
};

export type WorkspacePreferences = {
  conversations?: import("./conversation-settings").ConversationSettings;
  appearance: WorkspaceAppearance;
  modelSettings: WorkspaceModelSettings;
};
