import type { DecisionEmailInput } from "../agent";
import type { GoogleEvent } from "../google";
import type { Decision } from "../types";
import type { TemporalContext } from "../temporal";
import type { LifeMemory } from "../life-profile";
import type { ExistingDecisionContext } from "./existing-decisions";

export type DiscoverySignalType = "booking" | "subscription" | "promotion" | "invoice" | "invitation" | "deadline" | "calendar" | "purchase" | "travel" | "other";

export type DiscoveryCandidate = {
  id: string;
  situationKey: string;
  signalType: DiscoverySignalType;
  summary: string;
  emailIds: string[];
  potentialValue: number;
  triggerFacts: string[];
  researchQuestions: string[];
};

export type DiscoveryRejection = {
  candidateId: string;
  summary: string;
  reason: string;
};

export type DiscoveryAuditEntry = {
  tool: string;
  input: Record<string, unknown>;
  result: unknown;
  ok: boolean;
};

export type DiscoveryRefreshAuditEvent =
  | { stage: "prefilter"; emailId: string; bucket: "obvious_noise" | "uncertain" | "strong_candidate"; reason: string; signalType: DiscoverySignalType; situationKey: string; potentialValue: number; triggerFacts: string[]; researchQuestions: string[]; templateFingerprint: string; active: boolean }
  | { stage: "intake"; emailId: string; shouldInvestigate: boolean; recovered: boolean; situationKey: string; signalType: DiscoverySignalType; summary: string; rejectionReason: string }
  | { stage: "intake_failure" | "recovery_failure"; emailIds: string[]; error: string; fallback: string }
  | { stage: "qualification_fallback"; batch: string; emailIds: string[]; primaryProvider: string; primaryModel: string; fallbackProvider: string; fallbackModel: string; error: string }
  | { stage: "model_usage"; purpose: "qualification" | "false_negative_review" | "research" | "verdict"; provider: string; model: string; batch?: string; candidateId?: string; durationMs: number; usage: Record<string, unknown> }
  | { stage: "candidate"; candidateId: string; situationKey: string; signalType: DiscoverySignalType; summary: string; emailIds: string[]; potentialValue: number }
  | { stage: "research_fallback"; candidateId: string; primaryProvider: string; primaryModel: string; fallbackProvider: string; fallbackModel: string; error: string }
  | { stage: "investigation"; candidateId: string; verdict: "card" | "no_card"; decisionKind: "obligation" | "disruption" | "optimization" | "choice" | "reply" | "none"; reason: string; accepted: boolean; gateReason: string; tools: string[]; externalCostDollars: number; scores: { actionability: number; personalRelevance: number; confidence: number; expectedValue: number }; title: string }
  | { stage: "failure"; candidateId: string; signalType: DiscoverySignalType; summary: string; emailIds: string[]; error: string };

export type DiscoveryReport = {
  decisions: Decision[];
  resolvedDecisionIds?: string[];
  reviewedEmailIds: string[];
  candidateCount: number;
  investigatedCount: number;
  rejected: DiscoveryRejection[];
  failedEmailIds: string[];
  failures: string[];
};

export type DiscoveryInput = {
  /** Authenticated account owner; userId may include a connection ID for caching. */

  userId: string;
  accessToken: string;
  emailReader?: (id: string) => Promise<DecisionEmailInput>;
  emailSearcher?: (query: string, limit: number) => Promise<DecisionEmailInput[]>;
  emails: DecisionEmailInput[];
  evidenceEmails?: DecisionEmailInput[];
  events: GoogleEvent[];
  existingDecisions: ExistingDecisionContext[];
  lifeMemory: LifeMemory;
  userTimeZone?: string;
  temporalContext?: TemporalContext;
  maxCandidates?: number;
  onProgress?: (message: string) => void;
  onAudit?: (event: DiscoveryRefreshAuditEvent) => void;
  onDecision?: (decision: Decision) => void;
  /** Proactive engine v2 only: extra categories this user wants surfaced. */
  proactiveGuidance?: string;
  /** Trusted source-change worker only; account-scoped existing context. */
  maintainChangedThreads?: boolean;
};
