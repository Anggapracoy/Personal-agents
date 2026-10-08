import { conversationOpeningGuidance } from "../conversation-copy";
import { z } from "zod";

export const emailReviewSchema = z.object({
  investigate: z.array(z.object({
    emailId: z.string().min(1).max(300),
    situationKey: z.string().min(1).max(180),
    recurringIssueKey: z.string().min(3).max(180).nullable().optional().describe("For recurring automated notices about the same real entity and unresolved issue across threads, a stable entity-plus-issue key without timestamps. Otherwise null. Never combine different properties, accounts, bookings or unrelated incidents."),
    signalType: z.enum(["booking", "subscription", "promotion", "invoice", "invitation", "deadline", "calendar", "purchase", "travel", "other"]),
    summary: z.string().min(1).max(500),
    potentialValue: z.number().int().min(0).max(100),
    triggerFacts: z.array(z.string().min(1).max(300)).max(10),
    researchQuestions: z.array(z.string().min(1).max(300)).max(10),
  })).max(30),
});

export const recoverySchema = z.object({
  recoverEmailIds: z.array(z.string().min(1).max(300)).max(30),
});

const optionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(100),
  sublabel: z.string().max(140),
  actionType: z.enum(["instant", "approval", "research", "link", "no_action"]),
  isPrimary: z.boolean(),
});

export const verdictSchema = z.object({
  verdict: z.enum(["card", "no_card"]),
  resolvedDecisions: z.array(z.object({ decisionId: z.string(), sourceMessageId: z.string(), reason: z.string().min(1) })).describe("Existing feed suggestions demonstrably handled by a NEW message in their own thread. Empty without direct evidence. Independent of whether there is a new card."),
  updatesDecisionId: z.string().min(1).max(300).nullable().describe("Existing Feed decision id only when new evidence materially changes that unresolved decision. Null for redundant reminders, new decisions, and no_card."),
  // The underlying real-world situation, independent of the message or
  // thread that revealed it. Nullable keeps no_card verdicts honest; the
  // actionability gate requires a value before accepting a card.
  incidentKey: z.string().min(3).max(240).nullable(),
  decisionKind: z.enum(["obligation", "disruption", "optimization", "choice", "reply", "none"]),
  replyProof: z.object({
    sourceMessageId: z.string().min(1).max(300),
    specificRequest: z.string().min(1).max(500).describe("The context-supported reason a response would be useful. An explicit question or request is not required."),
    personalRelevance: z.string().min(1).max(500),
    latestThreadChecked: z.boolean(),
    stillUnanswered: z.boolean(),
    unansweredEvidence: z.string().min(1).max(500),
  }).nullable().describe('Only for proactive-enabled useful incoming reply tasks. Null otherwise. Never infer unanswered state from unread status.'),
  reason: z.string().min(1).max(1000),
  category: z.enum(["schedule", "money", "food", "family", "shopping", "travel", "social"]),
  urgency: z.enum(["high", "medium", "low"]),
  title: z.string().min(1).max(140).describe("Plain and specific. Use 2-3 words, never more than 3. Keep it within 32 characters where possible. Name the thing, not the task: \"Leo’s waiver\", \"Dinner tonight\", \"Denver Friday\"."),
  subtitle: z.string().min(1).max(600).describe(conversationOpeningGuidance),
  iconKind: z.enum(["plane", "doc", "plate", "tv", "tag", "wine", "card", "calendar", "key", "gift", "shield", "pin", "cart", "people"]).describe("The one everyday object that stands for this request."),
  options: z.array(optionSchema).max(4),
  actionabilityScore: z.number().int().min(0).max(100),
  personalRelevanceScore: z.number().int().min(0).max(100),
  confidenceScore: z.number().int().min(0).max(100),
  expectedValueScore: z.number().int().min(0).max(100),
  currentPlanHasVerifiedDownside: z.boolean(),
  materialConsequenceVerified: z.boolean(),
  materialConsequenceDescription: z.string().max(500).nullable(),
  boundedChoiceVerified: z.boolean(),
  boundedChoiceDescription: z.string().max(500).nullable(),
  personalizedActionAvailable: z.boolean(),
  researchComplete: z.boolean(),
  needsMoreEvidence: z.boolean(),
  temporalStatus: z.enum(["future", "ongoing", "past_with_unresolved_consequence", "past_resolved", "not_time_bound", "unknown"]),
  relevantDateTime: z.string().max(100).nullable(),
  unresolvedPastConsequence: z.string().max(500).nullable(),
  optimizationProof: z.object({
    eligibilityOrOwnershipVerified: z.boolean(),
    preExistingNeedOrAvoidableDownsideVerified: z.boolean(),
    fitAndTermsVerified: z.boolean(),
    materialNetBenefitVerified: z.boolean(),
    supportingSourceIds: z.array(z.string().min(1).max(500)).max(20),
  }).nullable(),
  evidence: z.array(z.object({
    claim: z.string().min(1).max(500),
    sourceType: z.enum(["email", "calendar", "browser", "public_web", "account", "calculation"]),
    sourceId: z.string().max(500),
    sourceUrl: z.string().max(2048).nullable(),
    personalized: z.boolean(),
  })).max(20),
});

export type DiscoveryVerdict = z.infer<typeof verdictSchema>;
