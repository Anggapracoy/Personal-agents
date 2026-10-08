import { createHash } from "node:crypto";
import type { DecisionEmailInput } from "../agent";
import type { DiscoverySignalType } from "./types";

export type PrefilterBucket = "obvious_noise" | "uncertain" | "strong_candidate";

export type PrefilterDecision = {
  emailId: string;
  bucket: PrefilterBucket;
  reason: string;
  signalType: DiscoverySignalType;
  situationKey: string;
  potentialValue: number;
  triggerFacts: string[];
  researchQuestions: string[];
  templateFingerprint: string;
};

const AUTOMATED_LOCAL_PART = /^(?:no-?reply|noreply|notifications?|updates?|newsletter|news|digest|hello|marketing|info|team|support|alerts?|editor|posted|changelog|product|inside|specials|recommendations?|position-tracking)$/i;
const BULK_DOMAIN = /(?:beehiiv\.com|substack\.com|producthunt\.com|pinterest\.com|medium\.com|postmedia\.com|naturamarket\.ca|grammarly\.com|mailchimp\.com|sendgrid\.net|hubspotemail\.net|communications\.|email\.|mail\.)/i;

const HARD_PRESERVE = [
  /\baction required\b/i,
  /\b(?:failed|failure|declined|rejected|blocked|paused|suspended|disabled)\b/i,
  /\b(?:overdue|past due|unpaid|payment (?:failed|unsuccessful|due)|invoice due|balance due|couldn'?t process payment)\b/i,
  /\b(?:security alert|new sign[- ]?in|password|verification|verify your|method enrolled|data shared|permission granted)\b/i,
  /\b(?:refund|chargeback|unauthorized|incorrect charge|charged twice)\b/i,
  /\b(?:cancelled|canceled|rescheduled|schedule change|delayed|disrupted)\b/i,
  /\b(?:invited you|shared .{0,80} with you|awaiting your response|please respond|reply requested|rsvp)\b/i,
  /\breply (?:with|by|to)\b/i,
  /\b(?:subscription (?:ends|expires|renews)|renewal notice|auto[- ]?renew|trial (?:ends|expires))\b/i,
  /\b(?:upcoming (?:flight|trip|reservation)|flight confirmation|order confirmation|booking confirmation|reservation confirmation)\b/i,
  /\b(?:confirm by|respond by|due by|deadline|expires? (?:today|tomorrow|soon))\b/i,
];

const PERSONAL_BENEFIT = [
  /\b(?:first(?:\s+\w+){0,3}\s+(?:order|purchase|ride|delivery)|new customer|never (?:ordered|used))\b/i,
  /\b(?:your|member|account)\s+(?:credit|coupon|reward|points?|benefit|offer|discount)\b/i,
  /\b(?:points?|credits?|rewards?)\s+(?:expire|expiring|balance|available)\b/i,
  /\b(?:eligible|pre[- ]?approved|qualified)\b/i,
];

const OBVIOUS_CONTENT_NOISE = [
  /\b(?:daily|weekly) digest\b/i,
  /\bnewsletter\b/i,
  /\b(?:top|best|hottest) \d+\b/i,
  /\b(?:product|feature|release|platform) (?:update|updates|announcement)\b/i,
  /\b(?:introducing|announcing|what'?s new|new release|now available|is here)\b/i,
  /\b(?:recommended for you|you'?ll love these|inspired by|could be your vibe|your taste)\b/i,
  /\b(?:read more|latest stories|today'?s headlines|this week)\b/i,
  /\b(?:webinar|ama|live event|register now|starting soon)\b/i,
  /\b(?:complete|take|fill out|share your thoughts).{0,40}\bsurvey\b/i,
  /\b(?:write|leave) a review\b/i,
];

const GENERIC_PROMOTION = [
  /\b(?:save|sale|deal|discount|offer|promo|special)\b/i,
  /\b(?:up to|extra)\s+\d{1,3}%\s+off\b/i,
  /\b\d{1,3}%\s+off\b/i,
  /\b(?:buy|shop|subscribe|apply|book) now\b/i,
  /\b(?:last chance|final hours|limited time|ends (?:today|tonight|soon))\b/i,
];

const RECEIPT_OR_CONFIRMATION = /\b(?:receipt|confirmation|confirmed|reservation|booking|order id|itinerary|ticket)\b/i;
const MONEY_SIGNAL = /\b(?:invoice|payment|charge|charged|billing|subscription|renewal|receipt|refund|overdue|balance)\b/i;
const TRAVEL_SIGNAL = /\b(?:flight|airline|hotel|trip|travel|booking|reservation|departure|arrival|itinerary)\b/i;
const CALENDAR_SIGNAL = /\b(?:meeting|calendar|appointment|event|invite|invitation|rsvp|schedule|reschedule)\b/i;

function normalizedAddress(from: string) {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

function senderParts(from: string) {
  const address = normalizedAddress(from);
  const [localPart = "", domain = ""] = address.split("@");
  return { address, localPart, domain };
}

function cleanSubject(subject: string) {
  return subject
    .toLowerCase()
    .replace(/^\s*(?:re|fw|fwd)\s*:\s*/g, "")
    .replace(/\b\d{4,}\b/g, "#")
    .replace(/\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/g, "day")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function inferSignalType(text: string): DiscoverySignalType {
  if (/\b(?:invoice|overdue|unpaid|balance due|payment failed)\b/i.test(text)) return "invoice";
  if (/\b(?:subscription|renewal|trial|auto[- ]?renew)\b/i.test(text)) return "subscription";
  if (TRAVEL_SIGNAL.test(text)) return "booking";
  if (CALENDAR_SIGNAL.test(text)) return "calendar";
  if (/\b(?:discount|offer|sale|promo|coupon|points?|reward)\b/i.test(text)) return "promotion";
  if (/\b(?:purchase|order|receipt|charged)\b/i.test(text)) return "purchase";
  if (/\b(?:deadline|due by|expires?)\b/i.test(text)) return "deadline";
  if (/\b(?:invited|shared with you|collaborat)\b/i.test(text)) return "invitation";
  return "other";
}

function researchQuestions(signalType: DiscoverySignalType) {
  switch (signalType) {
    case "booking":
    case "travel": return ["Does this conflict with the calendar or face a verified disruption?", "Would changing it materially improve the outcome?"];
    case "subscription": return ["Is the service actually being used?", "Is an avoidable renewal or loss imminent?"];
    case "promotion": return [
      "Does this match an existing plan, repeated purchase, or demonstrated preference?",
      "Is this account eligible, likely unused when first-use is required, current, and materially cheaper after meaningful incremental costs?",
    ];
    case "invoice": return ["Is payment genuinely outstanding or disputed?", "What concrete action prevents a verified downside?"];
    case "invitation":
    case "calendar": return ["Is a response expected or is there a real conflict?", "Is the opportunity still current?"];
    default: return ["Does this create a personalized action with a verified benefit or downside now?"];
  }
}

function baseDecision(email: DecisionEmailInput, bucket: PrefilterBucket, reason: string, potentialValue: number, triggerFacts: string[]): PrefilterDecision {
  const text = `${email.subject}\n${email.snippet}\n${email.body.slice(0, 2_500)}`;
  const signalType = inferSignalType(text);
  const sender = normalizedAddress(email.from);
  const templateFingerprint = hash(`${sender}|${cleanSubject(email.subject)}`);
  return {
    emailId: email.id,
    bucket,
    reason,
    signalType,
    situationKey: `${signalType}:${email.threadId || templateFingerprint}`,
    potentialValue,
    triggerFacts: triggerFacts.slice(0, 8),
    researchQuestions: researchQuestions(signalType),
    templateFingerprint,
  };
}

/** Proactive engine v2 only: deliveries that need the user, and flight check-in. */
const ENGINE_PRESERVE = [
  /\b(?:signature required|delivery attempt(?:ed)?|missed (?:your )?delivery|held (?:at|for) pick ?up|ready for pick ?up|delivery (?:delayed|exception|failed))\b/i,
  /\b(?:check[- ]in (?:is )?(?:now )?(?:open|available)|online check[- ]in|time to check in|check in for your flight)\b/i,
];

export function prefilterEmail(email: DecisionEmailInput, options: { engine?: boolean } = {}): PrefilterDecision {
  const text = `${email.subject}\n${email.snippet}\n${email.body.slice(0, 6_000)}`;
  const headline = `${email.subject}\n${email.snippet}\n${email.body.slice(0, 400)}`;
  const { localPart, domain } = senderParts(email.from);
  const bulkHeaders = Boolean(email.listUnsubscribe)
    || /\b(?:bulk|list|junk)\b/i.test(email.precedence ?? "")
    || /\bauto-(?:generated|replied)\b/i.test(email.autoSubmitted ?? "");
  const automatedSender = AUTOMATED_LOCAL_PART.test(localPart) || BULK_DOMAIN.test(domain);
  const directConsumerMailbox = /^(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|icloud\.com|me\.com|yahoo\.com|proton\.me|protonmail\.com)$/i.test(domain)
    && !AUTOMATED_LOCAL_PART.test(localPart);
  const preserveMatches = [...HARD_PRESERVE, ...(options.engine ? ENGINE_PRESERVE : [])].flatMap((pattern) => headline.match(pattern)?.[0] ?? []);
  const benefitMatches = PERSONAL_BENEFIT.flatMap((pattern) => text.match(pattern)?.[0] ?? []);

  // Consequential account facts always fail open, even when they arrived from a
  // bulk sender or Promotions. Research—not this script—decides whether a card
  // is warranted.
  if (preserveMatches.length > 0) {
    return baseDecision(email, "strong_candidate", "A hard preservation rule matched a consequential personal or account signal.", 85, preserveMatches);
  }

  if (directConsumerMailbox) {
    return baseDecision(email, "uncertain", "Direct person-to-person mail can never be rejected by the deterministic prefilter.", 60, [email.subject]);
  }

  if (RECEIPT_OR_CONFIRMATION.test(text)) {
    return baseDecision(email, "uncertain", "Receipts and confirmations can establish bookings, renewals, or unexpected charges and require qualification.", 60, [email.subject]);
  }

  if (benefitMatches.length > 0) {
    return baseDecision(email, "uncertain", "The message describes an account-specific or first-use benefit that may match an existing plan.", 55, benefitMatches);
  }

  const contentNoise = OBVIOUS_CONTENT_NOISE.some((pattern) => pattern.test(text));
  const genericPromotion = GENERIC_PROMOTION.some((pattern) => pattern.test(text));
  const genericBulk = bulkHeaders || automatedSender;
  if (genericBulk && contentNoise) {
    return baseDecision(email, "obvious_noise", "Bulk content, newsletter, product announcement, survey, or recommendation with no preserved personal consequence.", 0, [email.subject]);
  }
  if (genericBulk && genericPromotion && !MONEY_SIGNAL.test(text) && !TRAVEL_SIGNAL.test(text)) {
    return baseDecision(email, "obvious_noise", "Generic bulk promotion with no account-specific benefit, existing plan, obligation, or failure.", 0, [email.subject]);
  }

  // Human-looking messages and anything the deterministic rules cannot prove
  // is noise remain eligible. False positives cost money; false negatives cost
  // trust, so uncertainty always fails open.
  const reason = genericBulk
    ? "Automated message was not provably harmless, so it remains eligible for model qualification."
    : "Human-looking or ambiguous message remains eligible for model qualification.";
  return baseDecision(email, "uncertain", reason, 45, [email.subject]);
}

export function prefilterEmails(emails: DecisionEmailInput[], options: { engine?: boolean } = {}) {
  return emails.map(email => prefilterEmail(email, options));
}
