import assert from "node:assert/strict";
import test from "node:test";
import { canReuseSpeculativeInvestigation, canonicalDiscoveryIncidentKey, discoveryCandidateGroupingKey, discoveryHarnessRouteForScan, discoveryIncidentIdentity, discoveryModelRouteForScan, evaluateDiscoveryVerdict, mergeCandidateEvidence } from "../lib/discovery/harness";
import { existingDecisionContextFromWorkspace } from "../lib/discovery/existing-decisions";
import { fetchGmailHistoryChanges, unreviewedGmailMessageIds } from "../lib/google";
import type { DiscoveryCandidate } from "../lib/discovery/types";
import type { DiscoveryVerdict } from "../lib/discovery/schemas";
import { compactLifeMemory, focusPriorityBonus, lifeMemoryPrompt } from "../lib/life-memory-context";
import type { LifeMemory } from "../lib/life-profile";
import type { WorkspaceStateData } from "../lib/types";

const lifeMemory: LifeMemory = {
  requiredVersion: 1,
  profile: {
    homeCity: "Toronto",
    homeCountry: "Canada",
    homeLat: 43.65,
    homeLng: -79.38,
    timeZone: "America/Toronto",
    travelMode: "transit",
    travelBufferMinutes: 30,
    goals: ["money", "life_admin"],
    customGoal: "Make time for a hike this month",
    customInstructions: "Use a professional tone.",
    profileVersion: 1,
    updatedAt: "2026-08-17T12:00:00.000Z",
  },
  facts: [],
};

test("large-scan optimization never changes the single-email Luna path", () => {
  assert.equal(discoveryModelRouteForScan(1), "luna");
  assert.equal(discoveryModelRouteForScan(500), "luna");
  assert.equal(discoveryHarnessRouteForScan(1, "optimized"), "legacy");
  assert.equal(discoveryHarnessRouteForScan(49, "optimized"), "legacy");
  assert.equal(discoveryHarnessRouteForScan(50, "optimized"), "optimized");
  assert.equal(discoveryHarnessRouteForScan(500, "legacy"), "legacy");
});

test("discovery receives the full meaning of every current card for semantic deduping", () => {
  const state: WorkspaceStateData = {
    decisions: [{
      id: "a16z-overlap",
      discoveryFingerprint: "calendar:a16z-gu-overlap:2026-08-20",
      sourceType: "email",
      category: "schedule",
      urgency: "high",
      title: "Resolve the overlapping August 20 meetings",
      subtitle: "The a16z meeting overlaps the Gu call.",
      whyThisAppeared: ["Both events occupy the same time."],
      originalContext: "The proposed a16z time is 5:30 PM and the Gu call starts at 5:45 PM.",
      executionContext: {
        sourceEmail: {
          messageId: "message-a16z",
          threadId: "thread-a16z",
          from: "scheduler@example.com",
          to: "user@example.com",
          subject: "a16z meeting",
          date: "2026-08-19T16:00:00.000Z",
          snippet: "Does 5:30 work?",
          body: "Does 5:30 work?",
          links: [],
          confirmationNumbers: [],
          attachments: [],
        },
        sourceCalendar: {
          eventIds: ["event-a16z", "event-gu"],
          events: [],
        },
      },
      options: [
        { id: "move-gu", label: "Confirm a16z and move the Gu call", actionType: "instant", isPrimary: true },
        { id: "move-a16z", label: "Keep the Gu call and change a16z", actionType: "instant" },
      ],
      dismissLabel: "Do nothing",
      createdAt: "2026-08-19T16:05:00.000Z",
    }],
    tasks: [],
    history: [],
    discardedDecisionIds: [],
  };

  assert.deepEqual(existingDecisionContextFromWorkspace(state), [{
    id: "a16z-overlap",
    status: "feed",
    category: "schedule",
    title: "Resolve the overlapping August 20 meetings",
    subtitle: "The a16z meeting overlaps the Gu call.",
    optionLabels: ["Confirm a16z and move the Gu call", "Keep the Gu call and change a16z"],
    selectedOutcome: undefined,
    userChoice: undefined,
    createdAt: "2026-08-19T16:05:00.000Z",
    resolvedAt: undefined,
    whyThisAppeared: ["Both events occupy the same time."],
    contextSummary: "The proposed a16z time is 5:30 PM and the Gu call starts at 5:45 PM.",
    sourceEmailIds: ["message-a16z"],
    sourceThreadIds: ["thread-a16z"],
    sourceCalendarEventIds: ["event-a16z", "event-gu"],
    fingerprint: "calendar:a16z-gu-overlap:2026-08-20",
    actionableUntil: undefined,
  }]);
});

test("completed history retains source context for same-occurrence deduping", () => {
  const contexts = existingDecisionContextFromWorkspace({
    decisions: [],
    tasks: [],
    discardedDecisionIds: [],
    history: [{
      id: "history-return-laptop",
      decisionId: "return-laptop",
      category: "shopping",
      title: "Return your Ramp MacBook",
      subtitle: "Firstbase is waiting for the company laptop.",
      time: "10:00 AM",
      group: "TODAY",
      status: "done",
      originalContext: "Firstbase requested the return of the Ramp-issued MacBook.",
      chosenOption: "Return the laptop",
      steps: [],
      outcome: "Return arranged",
    }],
  });
  assert.equal(contexts[0]?.contextSummary, "Firstbase requested the return of the Ramp-issued MacBook.");
});

test("every discovery model stage uses current-card context before proposing a duplicate", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /existingDecisionContextHash\(input\)/);
  assert.match(harness, /existingDecisions: compactExistingDecisions\(input\), emails: compactIntakeEmails\(batch\)/);
  assert.match(harness, /existingDecisions: compactExistingDecisions\(input\),\s+rejected:/);
  assert.match(harness, /EXISTING-CARD DEDUPE RULE/);
  assert.match(harness, /toolAudit: audit, existingDecisions: compactExistingDecisions\(input\)/);
  assert.match(harness, /Never split one situation into separate cards/);
});

test("saved onboarding context is compact, prompt-injected, and changes discovery priority", () => {
  assert.equal(compactLifeMemory(lifeMemory).profile?.homeCity, "Toronto");
  assert.match(lifeMemoryPrompt(lifeMemory), /Always use USER_LIFE_CONTEXT/);
  assert.match(lifeMemoryPrompt(lifeMemory), /Make time for a hike this month/);
  assert.equal(focusPriorityBonus({ signalType: "subscription", summary: "Renewal" }, lifeMemory.profile?.goals ?? []), 15);
  assert.equal(focusPriorityBonus({ signalType: "travel", summary: "Flight booking" }, lifeMemory.profile?.goals ?? []), 0);
});

test("scanner context excludes all retired task ratings", () => {
  const memory: LifeMemory = {
    ...lifeMemory,
    facts: [
      {
        id: "pending",
        kind: "decision_preference",
        stableKey: "choice:money:pending",
        value: { topic: "Review a possible subscription", preferredOutcome: "Cancel it" },
        source: "decision_choice",
        evidence: { count: 1 },
        confidence: .65,
        observedAt: "2026-08-20T12:00:00.000Z",
        lastConfirmedAt: null,
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
      {
        id: "liked",
        kind: "decision_preference",
        stableKey: "choice:money:liked",
        value: { topic: "Stop an unwanted charge", preferredOutcome: "Stop the charge", userPreference: "likes" },
        source: "decision_choice",
        evidence: { confirmedByUser: true },
        confidence: 1,
        observedAt: "2026-08-20T12:01:00.000Z",
        lastConfirmedAt: "2026-08-20T12:02:00.000Z",
        updatedAt: "2026-08-20T12:02:00.000Z",
      },
      {
        id: "disliked",
        kind: "decision_preference",
        stableKey: "choice:shopping:disliked",
        value: { topic: "Research candy listings", preferredOutcome: "Send a comparison", userPreference: "does_not_like" },
        source: "decision_choice",
        evidence: { confirmedByUser: true },
        confidence: 1,
        observedAt: "2026-08-20T12:03:00.000Z",
        lastConfirmedAt: "2026-08-20T12:04:00.000Z",
        updatedAt: "2026-08-20T12:04:00.000Z",
      },
    ],
  };
  const compact = compactLifeMemory(memory);
  assert.equal(compact.facts.length, 0);
  assert.doesNotMatch(JSON.stringify(compact), /decision_preference|preferredOutcome/);
  assert.match(lifeMemoryPrompt(memory), /Use a professional tone/);

});

const candidate: DiscoveryCandidate = {
  id: "candidate-test",
  situationKey: "subscription:test",
  signalType: "subscription",
  summary: "A subscription may renew.",
  emailIds: ["email-1"],
  potentialValue: 80,
  triggerFacts: ["Renewal email"],
  researchQuestions: ["Does the user use it?"],
};

test("speculative research is reused only when it covers every final source", () => {
  const provisional = {
    ...candidate,
    emailIds: ["email-1", "email-2", "email-3"],
    triggerFacts: ["Initial failure", "Repeated failure"],
    researchQuestions: ["Is the account still blocked?"],
  };
  const selected = {
    ...candidate,
    emailIds: ["email-1", "email-3"],
    potentialValue: 90,
    triggerFacts: ["Repeated failure"],
    researchQuestions: ["What fixes the account?"],
  };

  assert.equal(canReuseSpeculativeInvestigation(provisional, selected), true);
  assert.equal(canReuseSpeculativeInvestigation(selected, provisional), false);
  assert.equal(canReuseSpeculativeInvestigation({ ...provisional, signalType: "invoice" as const }, selected), false);

  const merged = mergeCandidateEvidence(selected, provisional);
  assert.deepEqual(merged.emailIds, ["email-1", "email-3", "email-2"]);
  assert.equal(merged.potentialValue, 90);
  assert.deepEqual(merged.triggerFacts, ["Repeated failure", "Initial failure"]);
  assert.deepEqual(merged.researchQuestions, ["What fixes the account?", "Is the account still blocked?"]);
});

function verdict(overrides: Partial<DiscoveryVerdict> = {}): DiscoveryVerdict {
  return {
    verdict: "card",
    updatesDecisionId: null,
    incidentKey: "example:subscription-account:unused-renewal",
    decisionKind: "optimization",
    reason: "The renewal is avoidable and verified usage is low.",
    actionabilityScore: 90,
    personalRelevanceScore: 90,
    confidenceScore: 90,
    expectedValueScore: 80,
    currentPlanHasVerifiedDownside: true,
    materialConsequenceVerified: true,
    materialConsequenceDescription: "The user will pay a documented avoidable renewal charge.",
    boundedChoiceVerified: false,
    boundedChoiceDescription: null,
    personalizedActionAvailable: true,
    researchComplete: true,
    needsMoreEvidence: false,
    temporalStatus: "future",
    relevantDateTime: "2099-08-10T14:00:00Z",
    unresolvedPastConsequence: null,
    replyProof: null,
    resolvedDecisions: [],
    optimizationProof: {
      eligibilityOrOwnershipVerified: true,
      preExistingNeedOrAvoidableDownsideVerified: true,
      fitAndTermsVerified: true,
      materialNetBenefitVerified: true,
      supportingSourceIds: ["email-1", "account-usage"],
    },
    category: "money",
    urgency: "medium",
    title: "Cancel a subscription you no longer use?",
    subtitle: "It renews next week, and no usage was found in the account dashboard.",
    iconKind: "tv",
    evidence: [
      { claim: "The plan renews next week for $120.", sourceType: "email", sourceId: "email-1", sourceUrl: null, personalized: true },
      { claim: "The account dashboard shows no activity in 90 days.", sourceType: "browser", sourceId: "account-usage", sourceUrl: "https://example.com/account", personalized: true },
    ],
    options: [
      { id: "cancel", label: "Cancel before renewal", sublabel: "Avoid the verified charge.", actionType: "approval", isPrimary: true },
      { id: "keep", label: "Keep it", sublabel: "Take no action.", actionType: "instant", isPrimary: false },
    ],
    ...overrides,
  };
}

test("real-world incident identity deduplicates cards across Gmail threads and intake types", () => {
  const first = discoveryIncidentIdentity(verdict({
    incidentKey: "OpenAI : Organization ABC : API Rate-Limit Block",
    title: "Restore OpenAI API throughput",
  }), {
    ...candidate,
    id: "candidate-thread-one",
    situationKey: "conversation:gmail:thread-one",
    signalType: "other",
  });
  const second = discoveryIncidentIdentity(verdict({
    incidentKey: "openai:organization-abc:api-rate-limit-block",
    title: "Resolve the OpenAI rate-limit block",
  }), {
    ...candidate,
    id: "candidate-thread-two",
    situationKey: "conversation:gmail:thread-two",
    signalType: "invitation",
  });

  assert.equal(canonicalDiscoveryIncidentKey(" OpenAI / Organization ABC / API Rate-Limit Block "), "openai:organization:abc:api:rate:limit:block");
  assert.deepEqual(first, second);
  assert.match(first.fingerprint, /^incident:/);
});

test("real-world incident identity keeps genuinely separate obligations separate", () => {
  const first = discoveryIncidentIdentity(verdict({ incidentKey: "iconscout:invoice-1001:overdue" }), candidate);
  const second = discoveryIncidentIdentity(verdict({ incidentKey: "iconscout:invoice-1002:overdue" }), candidate);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("actionability gate rejects raw facts even when the model requests a card", () => {
  const result = evaluateDiscoveryVerdict(verdict({
    currentPlanHasVerifiedDownside: false,
    reason: "The user has a subscription.",
  }), candidate);
  assert.equal(result.ok, false);
  assert.match(result.reason, /verified downside/i);
});

test("actionability gate rejects subscription cards without independent personalized evidence", () => {
  const result = evaluateDiscoveryVerdict(verdict({
    evidence: [{ claim: "The plan renews next week.", sourceType: "email", sourceId: "email-1", sourceUrl: null, personalized: true }],
  }), candidate);
  assert.equal(result.ok, false);
  assert.match(result.reason, /cross-source/i);
});

test("actionability gate accepts a fully researched personalized decision", () => {
  assert.deepEqual(evaluateDiscoveryVerdict(verdict(), candidate), {
    ok: true,
    reason: "The renewal is avoidable and verified usage is low.",
  });
});

test("actionability gate rejects email and interface mechanics as card choices", () => {
  for (const label of ["Reply to the email", "Draft a response", "Forward to support", "Open 2FA Setup", "Review 2FA Requirements"]) {
    const result = evaluateDiscoveryVerdict(verdict({
      decisionKind: "obligation",
      optimizationProof: null,
      options: [
        { id: "mechanic", label, sublabel: "Use the source message.", actionType: "link", isPrimary: true },
        { id: "ignore", label: "Keep the current plan", sublabel: "Take no action.", actionType: "instant", isPrimary: false },
      ],
    }), { ...candidate, signalType: "other" });
    assert.equal(result.ok, false, label);
    assert.match(result.reason, /instead of a real-world outcome/i);
  }
});

test("actionability gate accepts outcome-oriented choices even when execution needs a site or message", () => {
  const accountDeadline = { ...candidate, signalType: "deadline" as const, summary: "GitHub requires 2FA before access is restricted." };
  const result = evaluateDiscoveryVerdict(verdict({
    decisionKind: "obligation",
    optimizationProof: null,
    options: [
      { id: "secure", label: "Set up 2FA", sublabel: "Secure the account before the deadline.", actionType: "link", isPrimary: true },
      { id: "choose", label: "Choose a 2FA method", sublabel: "Compare passkeys, apps, and security keys.", actionType: "research", isPrimary: false },
    ],
  }), accountDeadline);
  assert.equal(result.ok, true);
});

test("actionability gate rejects a flight that already departed", () => {
  const flight = { ...candidate, signalType: "booking" as const, summary: "A flight was booked for August 10." };
  const result = evaluateDiscoveryVerdict(verdict({
    category: "travel",
    decisionKind: "obligation",
    temporalStatus: "past_resolved",
    relevantDateTime: "2026-08-10T14:00:00Z",
    unresolvedPastConsequence: null,
    reason: "The confirmed flight has already departed.",
  }), flight, "2026-08-12T14:00:00Z");
  assert.equal(result.ok, false);
  assert.match(result.reason, /already ended/i);
});

test("actionability gate rejects a model claiming a past flight is future", () => {
  const flight = { ...candidate, signalType: "booking" as const, summary: "A flight was booked for August 10." };
  const result = evaluateDiscoveryVerdict(verdict({
    category: "travel",
    temporalStatus: "future",
    relevantDateTime: "2026-08-10T14:00:00Z",
  }), flight, "2026-08-12T14:00:00Z");
  assert.equal(result.ok, false);
  assert.match(result.reason, /already past/i);
});

test("actionability gate permits a past trip only for a concrete unresolved consequence", () => {
  const flight = { ...candidate, signalType: "booking" as const, summary: "A cancelled flight still has an unpaid refund." };
  const result = evaluateDiscoveryVerdict(verdict({
    category: "travel",
    decisionKind: "disruption",
    temporalStatus: "past_with_unresolved_consequence",
    relevantDateTime: "2026-08-30T14:00:00Z",
    unresolvedPastConsequence: "The airline still owes the documented cancellation refund.",
  }), flight, "2026-08-12T14:00:00Z");
  assert.equal(result.ok, true);
});

test("actionability gate allows a verified disruption whose root cause is the agent task", () => {
  const disruption = { ...candidate, signalType: "other" as const, summary: "A production deployment failed." };
  const result = evaluateDiscoveryVerdict(verdict({
    decisionKind: "disruption",
    reason: "The production release is blocked; the agent can diagnose and repair it.",
    researchComplete: false,
    needsMoreEvidence: true,
    evidence: [
      { claim: "The user's production deployment failed.", sourceType: "email", sourceId: "email-1", sourceUrl: null, personalized: true },
    ],
  }), disruption);
  assert.equal(result.ok, true);
});

test("actionability gate allows a verified disruption discovered behind a promotional trigger", () => {
  const disruption = { ...candidate, signalType: "promotion" as const, summary: "A service payment failed." };
  const result = evaluateDiscoveryVerdict(verdict({
    decisionKind: "disruption",
    reason: "Repeated payment failures have interrupted an actively used service.",
    researchComplete: true,
    needsMoreEvidence: false,
    optimizationProof: null,
    evidence: [
      { claim: "The user's subscription payment repeatedly failed and service is interrupted.", sourceType: "email", sourceId: "email-1", sourceUrl: null, personalized: true },
    ],
  }), disruption);
  assert.equal(result.ok, true);
});

test("actionability gate accepts a first-use offer backed by independent Gmail preference history", () => {
  const promotion = { ...candidate, signalType: "promotion" as const, emailIds: ["offer-email"], summary: "60% off a first DoorDash order." };
  const result = evaluateDiscoveryVerdict(verdict({
    reason: "A current first-order offer matches the user's repeated comparable meal orders and saves up to $22.",
    evidence: [
      { claim: "The current account-addressed offer provides 60% off a first order, up to $22.", sourceType: "email", sourceId: "offer-email", sourceUrl: null, personalized: true },
      { claim: "A broad DoorDash receipt search found no prior orders, making first-use status likely.", sourceType: "account", sourceId: "gmail-history:no-doordash-orders", sourceUrl: null, personalized: true },
      { claim: "Separate order history shows repeated purchases of the same cuisine from another delivery service.", sourceType: "email", sourceId: "ubereats-order-history", sourceUrl: null, personalized: true },
    ],
    optimizationProof: {
      eligibilityOrOwnershipVerified: true,
      preExistingNeedOrAvoidableDownsideVerified: true,
      fitAndTermsVerified: true,
      materialNetBenefitVerified: true,
      supportingSourceIds: ["offer-email", "gmail-history:no-doordash-orders", "ubereats-order-history"],
    },
  }), promotion);
  assert.equal(result.ok, true);
});

test("actionability gate rejects a first-use promotion supported only by the offer itself", () => {
  const promotion = { ...candidate, signalType: "promotion" as const, emailIds: ["offer-email"], summary: "60% off a first DoorDash order." };
  const result = evaluateDiscoveryVerdict(verdict({
    evidence: [
      { claim: "The email advertises 60% off a first order.", sourceType: "email", sourceId: "offer-email", sourceUrl: null, personalized: true },
    ],
    optimizationProof: {
      eligibilityOrOwnershipVerified: true,
      preExistingNeedOrAvoidableDownsideVerified: true,
      fitAndTermsVerified: true,
      materialNetBenefitVerified: true,
      supportingSourceIds: ["offer-email"],
    },
  }), promotion);
  assert.equal(result.ok, false);
  assert.match(result.reason, /independent cross-source personalized evidence/i);
});

test("actionability gate rejects a promotion when structured proof has no pre-existing need", () => {
  const promotion = { ...candidate, signalType: "promotion" as const, emailIds: ["offer-email"], summary: "60% off a first DoorDash order." };
  const result = evaluateDiscoveryVerdict(verdict({
    optimizationProof: {
      eligibilityOrOwnershipVerified: true,
      preExistingNeedOrAvoidableDownsideVerified: false,
      fitAndTermsVerified: true,
      materialNetBenefitVerified: true,
      supportingSourceIds: ["offer-email", "gmail-history:no-doordash-orders"],
    },
  }), promotion);
  assert.equal(result.ok, false);
  assert.match(result.reason, /structured proof/i);
});

test("actionability gate rejects optional outreach without a material consequence", () => {
  const outreach = { ...candidate, signalType: "invitation" as const, summary: "A product founder asked why the user signed up." };
  const result = evaluateDiscoveryVerdict(verdict({
    decisionKind: "obligation",
    reason: "A founder asked a personalized onboarding question and is waiting for a reply.",
    materialConsequenceVerified: false,
    materialConsequenceDescription: null,
    optimizationProof: null,
  }), outreach);
  assert.equal(result.ok, false);
  assert.match(result.reason, /material consequence/i);
});

test("actionability gate accepts a verified bounded choice without source-specific logic", () => {
  const choiceVerdict = verdict({
    incidentKey: "request:budget-change:unresolved-choice",
    decisionKind: "choice",
    reason: "A specific current request is still awaiting the user's decision.",
    personalRelevanceScore: 62,
    currentPlanHasVerifiedDownside: false,
    materialConsequenceVerified: false,
    materialConsequenceDescription: null,
    boundedChoiceVerified: true,
    boundedChoiceDescription: "The user is the named decision-maker, no outcome is recorded, and three executable outcomes are evidenced.",
    personalizedActionAvailable: true,
    optimizationProof: null,
    category: "money",
    urgency: "low",
    title: "Choose how to handle the requested budget change",
    subtitle: "The current request is awaiting a decision.",
    temporalStatus: "ongoing",
    relevantDateTime: "2099-08-24T16:00:00Z",
    evidence: [{
      claim: "The individually addressed request names the user as decision-maker and shows no recorded outcome.",
      sourceType: "email",
      sourceId: "choice-email",
      sourceUrl: null,
      personalized: true,
    }],
    options: [
      { id: "approve", label: "Approve the requested change", sublabel: "Authorize the proposed outcome.", actionType: "approval", isPrimary: true },
      { id: "decline", label: "Decline the requested change", sublabel: "Keep the current arrangement.", actionType: "approval", isPrimary: false },
      { id: "revise", label: "Propose a revised amount", sublabel: "Offer a different bounded outcome.", actionType: "approval", isPrimary: false },
    ],
  });
  for (const signalType of ["booking", "subscription", "promotion", "invoice", "invitation", "deadline", "calendar", "purchase", "travel", "other"] as const) {
    const result = evaluateDiscoveryVerdict(choiceVerdict, {
      ...candidate,
      signalType,
      situationKey: `source-neutral:${signalType}`,
      emailIds: [`choice-${signalType}`],
      summary: "A current personalized request presents a bounded unresolved choice.",
    }, "2099-08-23T16:00:00Z");
    assert.equal(result.ok, true, `bounded choice should not depend on ${signalType}`);
  }
});

test("discovery separates useful replies from material consequences and irrelevant outreach", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /outreach with no concrete personal relevance or useful next step is no_card/i);
  assert.match(harness, /person waiting for a reply is not[\s\S]*material consequence or bounded choice/i);
  assert.match(harness, /mere request to engage, talk, answer, or reply is not a bounded choice/i);
});

test("discovery prompts preserve verified bounded choices without workflow-specific branching", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /GENERAL BOUNDED-CHOICE RULE/);
  assert.match(harness, /complete alternative qualification basis/i);
  assert.match(harness, /source-neutral and category-neutral/i);
  assert.match(harness, /never branch on a provider, website, card category, message type, or example workflow/i);
  assert.match(harness, /do not additionally demand a prior commitment, established relationship, conflict, or unrelated material consequence/i);
  assert.match(harness, /Generic engagement is not a bounded choice/i);
  assert.doesNotMatch(harness, /UNRESOLVED RSVP RULE|isVerifiedUnresolvedDirectRsvp|DIRECT_RSVP_OUTCOME/);
});

test("discovery prompts preserve direct delegated actions whose requested mutation is still missing", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /direct, concrete request[\s\S]*delegated job/i);
  assert.match(harness, /requested external state does not exist yet[\s\S]*missing mutation may be the work to do/i);
  assert.match(harness, /requested mutation is absent[\s\S]*creating that missing state is the requested work/i);
  assert.match(harness, /Apply this from evidence and capabilities, never from a source-specific template/i);
});

test("discovery prompts retain outcome labels with an explicit verified-reply exception", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /An explicitly enabled and verified reply task may use Reply or Draft a reply/i);
  assert.match(harness, /Never label an option with inbox mechanics such as Reply, Draft, Forward/i);
  assert.match(harness, /Name the result the user would get, not an intermediate execution step/i);
  assert.match(harness, /label the intended outcome rather than the destination/i);
});

test("discovery options preserve outcome diversity without workflow-specific instructions", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /OUTCOME-DIVERSITY RULE/i);
  assert.match(harness, /distinguish materially different ways to resolve the evidenced situation/i);
  assert.match(harness, /Avoid alternate phrasings of the same action and invented alternatives/i);
  assert.match(harness, /never invent them/i);
});

test("opportunities use general eligibility, history, and personal-fit evidence", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /Verify eligibility claims against available history/i);
  assert.match(harness, /pre-existing goal, plan, preference, repeated behavior, or avoidable downside/i);
  assert.match(harness, /Missing records alone do not prove non-use or intent/i);
  assert.match(harness, /propose bounded work toward the evidenced goal/i);
});

test("scan route logs every refresh stage and reserves legacy for technical failures", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
  for (const stage of ["refresh start", "sources fetched", "refresh complete", "refresh failed"]) assert.match(route, new RegExp(stage));
  assert.match(route, /report\.failedEmailIds/);
  assert.match(route, /grounded no_card verdict[\s\S]*never falls through to legacy generation/);
});

test("refresh caps ordinary inbox discovery at one week while retaining the critical-message safety query", async () => {
  const { readFile } = await import("node:fs/promises");
  const google = await readFile(new URL("../lib/google.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
  assert.match(google, /CRITICAL_GMAIL_QUERY[\s\S]*subject:payment[\s\S]*past due[\s\S]*service paused/);
  assert.match(google, /const query = "in:inbox newer_than:7d"/);
  assert.match(google, /fetchDiscoveryEmailRefs[\s\S]*fetchRecentEmailRefs[\s\S]*fetchCriticalEmailRefs/);
  const discoveryRefs = google.slice(google.indexOf("export async function fetchDiscoveryEmailRefs"), google.indexOf("export async function fetchGmailProfileHistoryId"));
  assert.doesNotMatch(discoveryRefs, /fetchSubscriptionEmailRefs/);
  assert.match(route, /fetchDiscoveryEmailRefs\(accessToken\)/);
});

test("qualification retries malformed critic batches without turning ordinary bulk mail into candidates", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /async function recoverRejectedBatch/);
  assert.match(harness, /batch\.length > 5[\s\S]*recoverRejectedBatch\(input, batch\.slice\(0, middle\)/);
  assert.match(harness, /generic newsletters, product announcements, broad sales/);
  assert.match(harness, /mere theoretical usefulness is not enough/);
  assert.match(harness, /temporalDate: temporalContext\.currentLocalDate/);
  assert.match(harness, /Reject a past event or expired offer unless a concrete unresolved obligation or still-available follow-up remains/i);
});

test("automatic discovery routes every scan to Luna and uses the optimized full-scan scheduler", async () => {
  assert.equal(discoveryModelRouteForScan(1), "luna");
  assert.equal(discoveryModelRouteForScan(49), "luna");
  assert.equal(discoveryModelRouteForScan(50), "luna");
  assert.equal(discoveryModelRouteForScan(150), "luna");

  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  const scanRoute = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
  const evaluator = await readFile(new URL("../scripts/decision-discovery-eval.ts", import.meta.url), "utf8");
  assert.match(harness, /DISCOVERY_RESEARCH_MODEL_ID \?\? "zai-glm-4\.7"/);
  assert.match(harness, /DISCOVERY_CEREBRAS_ENABLED !== "true"/);
  assert.match(harness, /createOpenAICompatible\([\s\S]*name: "cerebras"[\s\S]*baseURL: "https:\/\/api\.cerebras\.ai\/v1"/);
  assert.match(harness, /clear_thinking: false/);
  assert.match(harness, /`<think>`|`<think>\$\{part\.text\}<\/think>`/);
  assert.match(harness, /wrapLanguageModel\(\{ model: cerebras\(modelId\), middleware: preserveGlmReasoning \}\)/);
  assert.match(harness, /const runResearch[\s\S]*generateText\(\{[\s\S]*model: selected\.model,[\s\S]*tools: registry\.tools/);
  assert.match(harness, /DISCOVERY_VERDICT_MODEL_ID \?\? "gpt-6-luna"/);
  assert.match(harness, /DISCOVERY_BENCHMARK_MODEL_ID/);
  assert.match(harness, /modelId === "gemini-3\.7-flash"/);
  assert.match(harness, /DEFAULT_LARGE_SCAN_THRESHOLD = 50/);
  assert.match(harness, /discoveryModelRouteForScan\(input\.emails\.length\)/);
  assert.doesNotMatch(harness, /automaticLargeScanModel/);
  assert.match(harness, /reasoningEffort: "medium"/);
  assert.match(harness, /serviceTier: "priority"/);
  assert.match(harness, /OPTIMIZED_REVIEW_BATCH_SIZE = 25/);
  assert.match(harness, /OPTIMIZED_RECOVERY_BATCH_SIZE = 12/);
  assert.doesNotMatch(harness, /DISCOVERY_MAX_CANDIDATES/);
  assert.doesNotMatch(harness, /defaultCandidateBudget: investigationProvider === "cerebras" \? 3 : 5/);
  assert.match(harness, /defaultCandidateBudget: Number\.POSITIVE_INFINITY/);
  assert.doesNotMatch(scanRoute, /DISCOVERY_SCAN_MAX_CANDIDATES/);
  assert.doesNotMatch(scanRoute, /maxCandidates,/);
  assert.match(evaluator, /maxCandidates: maxCandidates \?\? "unbounded"/);
  assert.match(harness, /for \(const review of result\.output\.investigate\)/);
  assert.match(harness, /rejectedForCritic: batch\.length - returned\.size/);
  assert.match(harness, /const recoveryLane = createConcurrencyLane\(configuration\.recoveryConcurrency\)/);
  assert.match(harness, /const recovered = await recoverRejectedBatch[\s\S]*onProvisionalCandidates\?\.\(candidatesFromReviews[\s\S]*const batchReviews = await batchReviewsPromise/);
  assert.match(harness, /await Promise\.all\(recoveryTasks\)/);
  assert.match(harness, /output: supportsTypedVerdict\(selected\.provider\) \? Output\.object\(\{ schema: verdictSchema \}\) : undefined/);
  assert.match(harness, /Cerebras still uses a[\s\S]*separate typed verdict model/);
  assert.match(harness, /model: critic\.model,[\s\S]*providerOptions: discoveryProviderOptions\(critic, "verdict", input\)/);
  assert.doesNotMatch(harness, /selective verdict fast exit/);
  assert.match(harness, /DISCOVERY_RESEARCH_FALLBACK_MODEL_ID \?\? "gpt-6-luna"/);
});

test("Gmail history pagination returns each newly added message once", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const value = String(url);
    calls.push(value);
    const second = value.includes("pageToken=next");
    return new Response(JSON.stringify(second
      ? { historyId: "103", history: [{ messagesAdded: [{ message: { id: "m2", threadId: "t2" } }] }] }
      : { historyId: "102", nextPageToken: "next", history: [{ messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] }, { messages: [{ id: "label-only", threadId: "old-thread" }] }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await fetchGmailHistoryChanges("token", "100");
    assert.equal(result.historyId, "103");
    assert.deepEqual(result.messages.map((message) => message.id), ["m1", "m2"]);
    assert.equal(calls.length, 2);
    assert.match(calls[0] ?? "", /startHistoryId=100/);
    assert.match(calls[0] ?? "", /historyTypes=messageAdded/);
    assert.doesNotMatch(calls[0] ?? "", /labelAdded/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Gmail label-only backlog cannot replay old messages as new decisions", async () => {
  const originalFetch = globalThis.fetch;
  const labelChanges = Array.from({ length: 670 }, (_, index) => ({
    labelsAdded: [{ message: { id: `old-${index}`, threadId: `thread-${index}` } }],
    messages: [{ id: `old-${index}`, threadId: `thread-${index}` }],
  }));
  globalThis.fetch = (async () => new Response(JSON.stringify({
    historyId: "200",
    history: [
      ...labelChanges,
      { messagesAdded: [{ message: { id: "genuinely-new", threadId: "new-thread" } }] },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const result = await fetchGmailHistoryChanges("token", "100");
    assert.deepEqual(result.messages, [{ id: "genuinely-new", threadId: "new-thread" }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("reviewed Gmail messages stay excluded during bounded history recovery", () => {
  const result = unreviewedGmailMessageIds([
    { id: "reviewed" },
    { id: "fresh" },
    { id: "fresh" },
  ], ["reviewed"]);
  assert.deepEqual(result, ["fresh"]);
});

test("Cerebras research failures fall back safely without dropping candidate emails", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../lib/discovery/types.ts", import.meta.url), "utf8");
  assert.match(harness, /DISCOVERY_RESEARCH_FALLBACK_MODEL_ID \?\? "gpt-6-luna"/);
  assert.match(harness, /research provider fallback/);
  assert.match(harness, /inOpenAiResearchLane/);
  assert.match(harness, /Waiting for the fallback research rate limit/);
  assert.match(types, /stage: "research_fallback"/);
});

test("repeated campaigns from one sender collapse into one investigation situation", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /repeatableSenderSignal/);
  assert.match(harness, /`\$\{review\.signalType\}:sender:\$\{repeatableSenderSignal\}`/);
});

test("Gmail replies stay in one situation even when the model changes its wording", () => {
  const email = {
    threadId: "thread-openai-support-123",
    from: "OpenAI Support <support@openai.com>",
    subject: "Re: streaming defect case",
    snippet: "Please send the complete reproduction.",
    body: "Support needs the complete request and raw event sequence.",
  };
  const first = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "restore-live-canvas-rendering",
    summary: "Restore live canvas rendering.",
    triggerFacts: ["Support is investigating."],
  }, email);
  const reply = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "advance-openai-streaming-defect-case",
    summary: "Advance the OpenAI streaming defect case.",
    triggerFacts: ["Support requested a reproduction."],
  }, email);

  assert.equal(first, "conversation:gmail:thread-openai-support-123");
  assert.equal(reply, first);
});

test("discovery prompts reject work outside Dash's connected capabilities", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /CAPABILITY BOUNDARY/);
  assert.match(harness, /cannot see or edit the user's local files, private source repositories, application runtime, unpublished logs/i);
  assert.match(harness, /Missing access means no_card/i);
  assert.match(harness, /User takeover is only for authentication, MFA, CAPTCHA/i);
  assert.match(harness, /It is not a substitute for inaccessible code, files, logs, or project access/i);
  assert.match(harness, /existingDecisions: compactExistingDecisions\(input\)/);
  assert.doesNotMatch(harness, /codebaseTopic|isCodebaseCard|blockedCodeTopic/);
});

test("the verdict prompt receives compact tool provenance instead of complete Gmail and DOM payloads", async () => {
  const { readFile } = await import("node:fs/promises");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(harness, /registry\.audit\.slice\(-30\)/);
  assert.match(harness, /resultPreview: JSON\.stringify\(entry\.result\)\.slice\(0, 2_000\)/);
  assert.doesNotMatch(harness, /slice\(0, 25_000\)/);
});

test("research tool responses and fan-out are bounded before they re-enter the model context", async () => {
  const { readFile } = await import("node:fs/promises");
  const tools = await readFile(new URL("../lib/discovery/tools.ts", import.meta.url), "utf8");
  const harness = await readFile(new URL("../lib/discovery/harness.ts", import.meta.url), "utf8");
  assert.match(tools, /let toolCallCount = 0/);
  assert.match(tools, /callNumber > 12/);
  assert.match(tools, /const modelResult = compact\(result, 6_000\)/);
  assert.match(tools, /messages: recentMatches\.map\(emailSearchResult\)/);
  assert.match(tools, /durableTtlMs/);
  assert.match(tools, /return modelResult/);
  assert.match(harness, /aim for 3-6 total tool calls/);
  assert.match(harness, /hard safety budget is 12 tool calls/);
  assert.match(harness, /stopWhen: stepCountIs\(7\)/);
});

test("discovery verdict schema requires every field for OpenAI strict structured output", async () => {
  const { z } = await import('zod');
  const { verdictSchema } = await import('../lib/discovery/schemas');
  const schema = z.toJSONSchema(verdictSchema);
  assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties!)));
  assert.ok(schema.required?.includes('updatesDecisionId'));
});

test('proactive reply tasks qualify without invented material harm, but require current personal evidence', () => {
  const reply = verdict({ decisionKind: 'reply', optimizationProof: null,
    currentPlanHasVerifiedDownside: false, materialConsequenceVerified: false, materialConsequenceDescription: null,
    boundedChoiceVerified: false, boundedChoiceDescription: null, temporalStatus: 'not_time_bound', relevantDateTime: null,
    replyProof: { sourceMessageId: 'email-1', specificRequest: 'How long do your sessions need to run?', personalRelevance: 'Support needs this to recommend a plan for the user’s existing account.', latestThreadChecked: true, stillUnanswered: true, unansweredEvidence: 'The latest thread message asks the user; no later sent reply exists.' },
    options: [{id:'reply',label:'Draft a reply',sublabel:'Answer the support question',actionType:'research',isPrimary:true},{id:'later',label:'Not now',sublabel:'',actionType:'no_action',isPrimary:false}],
  });
  const incoming = {...candidate,signalType:'other' as const};
  const check = (v: DiscoveryVerdict, enabled=true) => evaluateDiscoveryVerdict(v,incoming,'2026-09-26T18:00:00Z',enabled);
  assert.equal(check(reply).ok,true);
  assert.equal(check(reply,false).ok,false,'feature flag remains enforced');
  for (const proof of [null, {...reply.replyProof!,stillUnanswered:false}, {...reply.replyProof!,latestThreadChecked:false}, {...reply.replyProof!,sourceMessageId:'unrelated-email'}, {...reply.replyProof!,personalRelevance:' '}]) {
    assert.equal(check({...reply,replyProof:proof}).ok,false);
  }
  assert.equal(check({...reply,evidence:[]}).ok,false);
  assert.equal(check({...reply,researchComplete:false,needsMoreEvidence:true}).ok,false);
  assert.equal(check({...reply,temporalStatus:'past_resolved'}).ok,false);
  assert.equal(check({...reply,options:reply.options.map(o=>o.isPrimary?{...o,label:'Open website'}:o)}).ok,false);
});

test('recurring entity and issue groups across threads while keeping different entities separate',()=>{
 const review={signalType:'other' as const,situationKey:'notice',summary:'A monitored issue',triggerFacts:[],recurringIssueKey:'home-one:window-sensor:bypassed'};
 const email={from:'alerts@example.com',subject:'Status update',snippet:'',body:'',threadId:'one'};
 assert.equal(discoveryCandidateGroupingKey(review,email),discoveryCandidateGroupingKey(review,{...email,threadId:'two'}));
 assert.notEqual(discoveryCandidateGroupingKey(review,email),discoveryCandidateGroupingKey({...review,recurringIssueKey:'home-two:window-sensor:bypassed'},email));
 const ordinary={...review,recurringIssueKey:null};
 assert.notEqual(discoveryCandidateGroupingKey(ordinary,email),discoveryCandidateGroupingKey(ordinary,{...email,threadId:'two'}));
});
