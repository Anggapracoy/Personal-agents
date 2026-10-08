import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionEmailInput } from "../lib/agent";
import { discoveryCandidateGroupingKey } from "../lib/discovery/harness";
import { prefilterEmail } from "../lib/discovery/prefilter";

function email(overrides: Partial<DecisionEmailInput>): DecisionEmailInput {
  return {
    id: overrides.id ?? "email-1",
    threadId: overrides.threadId ?? "thread-1",
    subject: overrides.subject ?? "Message",
    from: overrides.from ?? "sender@example.com",
    to: overrides.to ?? "user@example.com",
    date: overrides.date ?? new Date().toUTCString(),
    snippet: overrides.snippet ?? "",
    body: overrides.body ?? "",
    links: overrides.links ?? [],
    confirmationNumbers: overrides.confirmationNumbers ?? [],
    attachments: overrides.attachments ?? [],
    labels: overrides.labels,
    listUnsubscribe: overrides.listUnsubscribe,
    precedence: overrides.precedence,
    autoSubmitted: overrides.autoSubmitted,
    replyTo: overrides.replyTo,
  };
}

test("rejects an obvious bulk content digest locally", () => {
  const result = prefilterEmail(email({
    subject: "Medium Daily Digest: the best stories this week",
    from: "Medium Daily Digest <noreply@medium.com>",
    listUnsubscribe: "<https://example.com/unsubscribe>",
  }));
  assert.equal(result.bucket, "obvious_noise");
});

test("never filters a failed deployment even from an automated sender", () => {
  const result = prefilterEmail(email({
    subject: "Failed production deployment",
    from: "Vercel <notifications@vercel.com>",
    listUnsubscribe: "<https://example.com/unsubscribe>",
  }));
  assert.equal(result.bucket, "strong_candidate");
});

test("never filters a personalized first-order discount", () => {
  const result = prefilterEmail(email({
    subject: "60% off your first DoorDash order",
    from: "DoorDash <no-reply@doordash.com>",
    listUnsubscribe: "<https://example.com/unsubscribe>",
  }));
  assert.equal(result.bucket, "uncertain");
});

test("never filters an upcoming booking confirmation", () => {
  const result = prefilterEmail(email({
    subject: "Your upcoming flight — booking confirmation",
    from: "reserve@example-airline.com",
    autoSubmitted: "auto-generated",
  }));
  assert.equal(result.bucket, "strong_candidate");
});

test("never filters an overdue invoice", () => {
  const result = prefilterEmail(email({
    subject: "Action required: invoice is 27 days past due",
    from: "billing@example.com",
    precedence: "bulk",
  }));
  assert.equal(result.bucket, "strong_candidate");
});

test("direct human-looking messages fail open", () => {
  const result = prefilterEmail(email({
    subject: "Inspired by your journey — seeking advice",
    from: "Alex Example <alex@example.com>",
  }));
  assert.equal(result.bucket, "uncertain");
});

test("never filters a bulk message containing an explicit reply request", () => {
  const result = prefilterEmail(email({
    subject: "Who are we missing?",
    from: "Founders, Inc. <lab@f.inc>",
    body: "Who is one great founder the teams should meet? Reply with their name + email and we'll invite them.",
    listUnsubscribe: "<https://example.com/unsubscribe>",
  }));
  assert.equal(result.bucket, "strong_candidate");
});

test("groups separate Vercel deployment failure notifications into one incident", () => {
  const first = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "other:one",
    summary: "Failed CLI deployment",
    triggerFacts: ["identity is not a member of the team"],
  }, email({ from: "Vercel <notifications@vercel.com>", subject: "Failed CLI deployment" }));
  const second = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "other:two",
    summary: "Production deployment failed",
    triggerFacts: ["kodov2 production failure"],
  }, email({ from: "Vercel <notifications@vercel.com>", subject: "Failed production deployment" }));
  assert.equal(first, second);
});

test("groups FlyNYON confirmation and upcoming-flight mail as one booking", () => {
  const confirmation = discoveryCandidateGroupingKey({
    signalType: "booking",
    situationKey: "booking:confirmation",
    summary: "FlyNYON order confirmation",
    triggerFacts: ["Order 338413"],
  }, email({ from: "FlyNYON <reserve@flynyon.com>", subject: "FlyNYON - Order Confirmation" }));
  const upcoming = discoveryCandidateGroupingKey({
    signalType: "booking",
    situationKey: "booking:upcoming",
    summary: "Upcoming flight and passenger waivers",
    triggerFacts: ["Arrive by 9:45 AM"],
  }, email({ from: "FlyNYON <reserve@flynyon.com>", subject: "Your Upcoming Flight With FlyNYON" }));
  assert.equal(confirmation, upcoming);
});

test("groups IconScout billing mail from a human contact and Stripe into one incident", () => {
  const accountContact = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "api-overage",
    summary: "API service paused over unpaid usage",
    triggerFacts: ["Monthly recurring API subscription is $123"],
  }, email({
    from: "Example Contact <contact@lottiefiles.com>",
    subject: "Re: Action Required: API Overage Invoice (March-April)",
    body: "INDIA - ICONSCOUT. The API service is paused over a pending payment.",
  }));
  const stripeReminder = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "stripe-invoice",
    summary: "IconScout invoice is overdue",
    triggerFacts: ["Invoice EXAMPLE-0015 is $123"],
  }, email({
    from: "Stripe <notifications@stripe.com>",
    subject: "Reminder: Your invoice from IconScout is 27 days past due",
  }));
  assert.equal(accountContact, stripeReminder);
});

test("groups the compact LottieFiles account-contact form of an IconScout overage thread", () => {
  const accountContact = discoveryCandidateGroupingKey({
    signalType: "invoice",
    situationKey: "invoice:opaque",
    summary: "Re: Action Required: API Overage Invoice (March-April)",
    triggerFacts: ["Payment is outstanding"],
  }, email({
    from: "Example Contact <contact@lottiefiles.com>",
    subject: "Re: Action Required: API Overage Invoice (March-April)",
  }));
  const stripeReminder = discoveryCandidateGroupingKey({
    signalType: "invoice",
    situationKey: "invoice:stripe",
    summary: "IconScout invoice is overdue",
    triggerFacts: ["Invoice EXAMPLE-0015"],
  }, email({
    from: "Stripe <notifications@stripe.com>",
    subject: "Reminder: Your invoice from IconScout #EXAMPLE-0015 is 27 days past due",
  }));
  assert.equal(accountContact, stripeReminder);
});

test("groups Cursor provider and Stripe retry notices into one payment incident", () => {
  const provider = discoveryCandidateGroupingKey({
    signalType: "invoice",
    situationKey: "cursor-provider-retry",
    summary: "Couldn't process payment",
    triggerFacts: ["Payment needs attention"],
  }, email({ from: "Cursor <hi@cursor.com>", subject: "Couldn't process payment" }));
  const stripe = discoveryCandidateGroupingKey({
    signalType: "invoice",
    situationKey: "cursor-stripe-retry",
    summary: "$226 payment to Cursor was unsuccessful",
    triggerFacts: ["Payment failed"],
  }, email({ from: "Cursor <failed-payments+account@stripe.com>", subject: "$123.00 payment to Cursor was unsuccessful" }));
  assert.equal(provider, stripe);
});

test("groups repeated Google security alerts into one account investigation", () => {
  const first = discoveryCandidateGroupingKey({ signalType: "other", situationKey: "alert-one", summary: "Security alert", triggerFacts: [] },
    email({ from: "Google <no-reply@accounts.google.com>", subject: "Security alert" }));
  const second = discoveryCandidateGroupingKey({ signalType: "other", situationKey: "alert-two", summary: "Critical security alert", triggerFacts: [] },
    email({ from: "Google <no-reply@accounts.google.com>", subject: "Critical security alert for michael@example.com" }));
  assert.equal(first, second);
});

test("groups updates to the same linked real-world entity across separate message threads", () => {
  const first = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "source:first-wording",
    summary: "A current choice is unresolved.",
    triggerFacts: ["First version"],
  }, email({
    threadId: "thread-one",
    links: ["https://service.example/action?eventId=stable-entity-123&version=1"],
  }));
  const update = discoveryCandidateGroupingKey({
    signalType: "invitation",
    situationKey: "source:updated-wording",
    summary: "The same choice was updated.",
    triggerFacts: ["Updated version"],
  }, email({
    threadId: "thread-two",
    links: ["https://service.example/action?eventId=stable-entity-123&version=2"],
  }));
  assert.equal(first, update);

  const differentEntity = discoveryCandidateGroupingKey({
    signalType: "other",
    situationKey: "source:different-wording",
    summary: "A different choice is unresolved.",
    triggerFacts: ["Different entity"],
  }, email({
    threadId: "thread-three",
    links: ["https://service.example/action?eventId=stable-entity-456&version=1"],
  }));
  assert.notEqual(first, differentEntity);
});
