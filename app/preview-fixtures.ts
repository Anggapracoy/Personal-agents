import { conversationKey, type ConversationMessages } from "../lib/conversation-settings";
import type { ThreadItem } from "../lib/harness/thread";
import type { AgentResult } from "../lib/harness/types";
import type { Decision, HistoryEntry, RunningTask } from "../lib/types";
import type { VaultItemSummary } from "./native-bridge";
import type { LifeProfileResponse } from "./workspace-model";

/** Sample data rendered by `?uiPreview=1` so every screen can be seen without a signed-in account. */
export const uiPreviewDecisions: Decision[] = [
  { id: "preview-proactive-dinner", category: "food", urgency: "medium", title: "I can sort out dinner tonight", whyThisAppeared: ["A few good spots nearby, and I’ll check for a table."], subtitle: "You’re free after 7. I can find a few good spots nearby and check for a table.", sourceType: "calendar", sourceLabel: "Based on your calendar", createdAt: "2026-08-24T15:00:00.000Z", originalContext: "Sample suggestion: find dinner options for tonight after 7.", options: [
    { id: "find-dinner", label: "Find a spot", actionType: "research", isPrimary: true }, { id: "stay-in", label: "Stay in instead", actionType: "no_action" },
  ], dismissLabel: "Not now" },
  { id: "preview-proactive-return", category: "shopping", urgency: "high", title: "Your return window closes Friday", subtitle: "Those headphones arrived two weeks ago. I can get the return started before it’s too late.", sourceType: "email", sourceLabel: "Gmail", createdAt: "2026-08-24T14:00:00.000Z", originalContext: "Sample suggestion: return the headphones before Friday.", options: [
    { id: "start-return", label: "Start return", actionType: "approval", isPrimary: true }, { id: "keep-headphones", label: "Keep them", actionType: "no_action" },
  ], dismissLabel: "Not now" },
  { id: "preview-proactive-weekend", category: "social", urgency: "low", title: "Saturday’s still wide open", subtitle: "There’s a food market and a new exhibition nearby. Want me to put together a relaxed afternoon?", sourceType: "calendar", sourceLabel: "A little ahead of time", createdAt: "2026-08-24T13:00:00.000Z", originalContext: "Sample suggestion: plan a relaxed Saturday afternoon.", options: [
    { id: "weekend-ideas", label: "Show me ideas", actionType: "research", isPrimary: true }, { id: "keep-free", label: "Keep it free", actionType: "no_action" },
  ], dismissLabel: "Not now" },
  { id: "preview-waiver", category: "family", urgency: "high", title: "Leo’s waiver is due Friday", subtitle: "Still unsigned · party is in 5 days", sourceType: "manual", sourceLabel: "Shared from Safari", createdAt: "2026-08-24T18:00:00.000Z", whyThisAppeared: ["You shared the party waiver and it is still unsigned."], originalContext: "Leo’s party waiver is due Friday.", options: [
    { id: "preview-sign", label: "Sign waiver", actionType: "approval", isPrimary: true }, { id: "preview-host", label: "Ask host", actionType: "approval" }, { id: "preview-skip", label: "Skip party", actionType: "approval" },
  ], dismissLabel: "Do nothing" },
  { id: "preview-flight", category: "travel", urgency: "medium", title: "Rain may disrupt your helicopter flight", subtitle: "70% chance of heavy rain during your booking", sourceType: "calendar", sourceLabel: "Weather + Calendar", createdAt: "2026-08-24T17:00:00.000Z", actionableUntil: "2026-08-29T15:00:00-04:00", whyThisAppeared: ["Your booking overlaps the heaviest rain in Saturday’s forecast."], originalContext: "Saturday helicopter flight and local forecast.", executionContext: { sourceCalendar: { sourceKind: "google", eventIds: ["preview-helicopter"], events: [{ id: "preview-helicopter", summary: "Helicopter flight", description: "", location: "Toronto Heli Tours", start: "2026-08-29T15:00:00-04:00", end: "2026-08-29T16:00:00-04:00", attendees: [], htmlLink: "https://calendar.google.com/" }] } }, options: [
    { id: "preview-reschedule", label: "Reschedule", actionType: "approval", isPrimary: true }, { id: "preview-keep", label: "Keep booking", actionType: "no_action" }, { id: "preview-alternatives", label: "Alternatives", actionType: "research" },
  ], dismissLabel: "Do nothing" },
  { id: "preview-renewal", category: "money", urgency: "medium", title: "IconScout renews for $149", subtitle: "You have not used it in 6 weeks", sourceType: "email", sourceLabel: "Gmail", createdAt: "2026-08-24T16:00:00.000Z", whyThisAppeared: ["A renewal is due in 3 days and recent activity suggests you may no longer need it."], originalContext: "IconScout renewal notice.", options: [
    { id: "preview-cancel", label: "Cancel renewal", actionType: "approval", isPrimary: true }, { id: "preview-keep-sub", label: "Keep it", actionType: "no_action" }, { id: "preview-remind", label: "Remind me", actionType: "instant" },
  ], dismissLabel: "Do nothing" },
];

export const uiPreviewTasks: RunningTask[] = [
  { id: "preview-working-task", runId: "preview-working-run", decisionId: "preview-working-decision", category: "food", title: "Dinner plans", subtitle: "Checking availability", status: "running", estimate: "Live", updatedAt: new Date().toISOString(), chosenOption: "Find a table for two tomorrow at 7.", originalContext: "Find a table for two tomorrow at 7." },
  {
    id: "preview-call-task", runId: "preview-call-run", decisionId: "preview-call-decision", category: "food", title: "Dinner at L’Artusi", subtitle: "On the phone", status: "waiting", estimate: "Calling", updatedAt: new Date().toISOString(), chosenOption: "Call L’Artusi and book dinner for tomorrow.", originalContext: "Book dinner at L’Artusi.",
    automaticPause: { id: "preview-call-pause", ready: true, reason: "Calling L’Artusi", wakeAt: null, eventKind: "phone_call", phoneCall: { type: "phone_call", callId: "preview-call", actionId: "00000000-0000-4000-8000-000000000001", phoneNumber: "+12125550100", recipientName: "L’Artusi", status: "in_progress" } },
  },
  {
    id: "preview-time-task", runId: "preview-time-run", decisionId: "preview-time-decision", category: "family", title: "Check the delivery", subtitle: "Waiting to check the delivery", status: "waiting", estimate: "Waiting", updatedAt: new Date().toISOString(), chosenOption: "Check the delivery again in an hour.", originalContext: "Check the delivery later.",
    automaticPause: { id: "preview-time-pause", ready: true, reason: "Giving the courier time to update tracking", wakeAt: new Date(Date.now() + 3600000).toISOString(), eventKind: null },
  },
  {
    id: "preview-wait-task", runId: "preview-wait-run", decisionId: "preview-wait-decision", category: "social", title: "Dinner with Alex", subtitle: "Waiting for Alex’s email reply", status: "waiting", estimate: "Waiting", updatedAt: new Date().toISOString(), chosenOption: "Ask Alex which evening works, then help me make a plan.", originalContext: "Plan dinner with Alex.",
    automaticPause: { id: "preview-pause", ready: true, reason: "Waiting for Alex’s email reply", wakeAt: null, eventKind: "gmail_reply" },
  },
  {
    id: "preview-takeover-task", runId: "preview-takeover-run", actionId: "preview-takeover-action", decisionId: "preview-sign-in", category: "travel", title: "Check my flight", subtitle: "Website sign-in needed", status: "needs_approval", chosenOption: "Check my booking", originalContext: "Review the upcoming flight.", approvalKind: "takeover", browserUsed: true, approvalRequest: { pageUrl: "https://www.delta.com/login", reason: "Sign in on Delta’s website, then I can check your booking." },
  },
  {
    id: "preview-live-task", runId: "preview-live-run", decisionId: "preview-live-decision", category: "food", title: "Booking L’Artusi", activity: { label: "Reading reservation options", icon: "browser" }, subtitle: "Sunday · 2 people · 5:00 PM", status: "running", estimate: "Live", updatedAt: new Date().toISOString(), chosenOption: "Book L’Artusi", originalContext: "Book L’Artusi for two people at 5:00 PM Sunday.", browserUsed: true,
  },
  {
    id: "preview-question-task", runId: "preview-question-run", actionId: "preview-question-action", decisionId: "preview-password", category: "social", title: "Reset your Example password", subtitle: "I need your answer to continue", status: "needs_approval", estimate: "Ready now", chosenOption: "Reset password", originalContext: "Reset the account password.", approvalKind: "questions",
    questionRequest: { questions: [
      { id: "account", question: "Which account should I reset?", answerType: "single_choice", options: [{ id: "personal", label: "Personal", description: "michael@example.com" }, { id: "work", label: "Work", description: "michael@company.com" }], placeholder: "" },
      { id: "recovery-note", question: "What should I label this password?", answerType: "text", options: [], placeholder: "For example, Personal account" },
      { id: "new-password", question: "What new password should I set?", answerType: "secret", options: [], placeholder: "Enter the new password" },
    ] },
  },
  {
    id: "preview-vault-task", runId: "preview-vault-run", actionId: "preview-vault-action", decisionId: "preview-waiver", category: "family", title: "Sign Leo’s waiver", subtitle: "Sign-in needed to continue", status: "needs_approval", estimate: "Ready now", chosenOption: "Sign waiver", originalContext: "Leo’s waiver is due Friday.", approvalKind: "vault_login", approvalRequest: { siteHost: "waiver.example", suggestedLabel: "Party waiver", reason: "Sign in to complete Leo’s waiver." },
  },
  {
    id: "preview-email-task", runId: "preview-email-run", actionId: "preview-email-action", decisionId: "preview-email", category: "travel", title: "Email Mom about Montreal", subtitle: "Ready to send", status: "needs_approval", estimate: "Ready now", chosenOption: "Draft email", originalContext: "Tell Mom about the Montreal trip.", approvalKind: "email_send", approvalRequest: { to: ["mom@example.com"], subject: "Montreal, Nov 4 to 6", body: "Hi Mom,\n\nI\u2019m looking at the train for Wednesday morning. Does that work for you?\n\nLove, Michael" },
  },
];

const montrealFollowUps: NonNullable<AgentResult["followUpActions"]> = [
      { id: "hotels", label: "Find hotels", description: "Search hotels near the venue", intent: "Find hotels near the concert venue for Nov 4 to 6.", actionType: "research", optionId: null, sourceUrl: null, requiresFreshEvidence: true },
      { id: "calendar", label: "Add to calendar", description: "Put the trip on the calendar", intent: "Add the Montreal trip, Nov 4 to 6, to my calendar.", actionType: "approval", optionId: null, sourceUrl: null, requiresFreshEvidence: false },
    ];
const montrealBlocks: NonNullable<AgentResult["blocks"]> = [
      { type: "text", style: "heading", text: "Toronto to Montreal, Nov 4 to 6" },
      { type: "stats", items: [{ label: "Length", value: "3 days", note: null }, { label: "Getting there", value: "~5 hr", note: "by train" }, { label: "Concert", value: "Thu eve", note: null }] },
      { type: "timeline", title: "Wednesday", summary: "Old Montreal, La Grande Roue", items: [{ label: "Afternoon", title: "Old Montreal and the Old Port", note: "Cobblestone streets, shops and a waterfront walk" }, { label: "Evening", title: "La Grande Roue (optional)", note: "Heated cabins" }] },
      { type: "timeline", title: "Thursday", summary: "Mount Royal, then the concert", items: [{ label: "Morning", title: "Mount Royal lookout", note: "If the weather’s decent" }, { label: "Afternoon", title: "Downtown, then rest", note: null }, { label: "Evening", title: "Early kosher dinner, then the show", note: null }] },
      { type: "timeline", title: "Friday", summary: "A slow morning, then home", items: [{ label: "Morning", title: "One last stroll, then head home", note: null }] },
      { type: "section", title: "Links and kosher food", collapsed: true, blocks: [
        { type: "place", name: "MK kosher directory", address: null, description: "Check certification and hours before going", imageUrl: null, url: "https://mk.ca/montreal/" },
      ] },
      { type: "event", title: "Omer concert", startIso: "2026-11-05T19:30:00-05:00", date: "Thu, Nov 5", time: "7:30 PM", location: "Place Bell, Laval", calendarActionId: "calendar" },
      { type: "key_value", title: "Tickets", items: [{ label: "Confirmation", value: "TK-48213", copyable: true }, { label: "Seats", value: "Section 104, row C", copyable: false }] },
      { type: "draft", channel: "email", status: "draft", to: ["mom@example.com"], subject: "Montreal, Nov 4 to 6", body: "Hi Mom, I’m looking at the train for Wednesday morning. Does that work for you?", },
      { type: "contact", name: "Hotel front desk", note: "Open 24 hours", phone: "+1 514 555 0100", email: "desk@example.com" },
      { type: "table", title: "Getting there", columns: ["Option", "Time", "Price"], rows: [{ cells: ["Train", "~5 hr", ""], best: true }, { cells: ["Flight", "~1.5 hr", ""], best: false }, { cells: ["Drive", "~5.5 hr", "Gas and tolls"], best: false }] },
      { type: "checklist", title: "Before you go", items: [{ text: "Tickets in hand", done: true }, { text: "ID for the border", done: false }, { text: "Book a hotel", done: false }] },
      { type: "action", actionIds: ["hotels", "calendar"] },
    ];

const polishTime = new Date(Date.now() - 5 * 60_000).toISOString();
export const uiPreviewHistory: HistoryEntry[] = [
  { id: 'preview-send-reference', runId: 'preview-send-reference-run', completedAt: polishTime, category: 'social', title: 'Send comparison', subtitle: 'Hey. What’s up?', time: 'now', group: 'TODAY', status: 'done', originalContext: 'Message motion comparison', chosenOption: 'Hi', steps: [], outcome: 'Message motion comparison' },
  { id: 'preview-vault-summary', runId: 'preview-vault-summary-run', completedAt: polishTime, category: 'shopping', title: 'Order my trainers', subtitle: 'Your login and card are ready.', time: 'now', group: 'TODAY', status: 'done', originalContext: 'Use my saved Nike account and card.', chosenOption: 'Use my saved Nike account and card.', steps: [], outcome: 'Details unlocked' },
  { id: 'preview-messages-polish', runId: 'preview-messages-polish-run', completedAt: polishTime, category: 'social', title: 'Weekend plans', subtitle: 'See you there', time: 'now', group: 'TODAY', status: 'done', originalContext: 'Plan a relaxed Saturday.', chosenOption: 'Any ideas for Saturday?', steps: [], outcome: 'Saturday plans' },
  { id: "preview-montreal-blocks", runId: "preview-montreal-blocks-run", completedAt: "2026-09-12T12:00:00Z", category: "social", title: "Montreal trip", subtitle: "A relaxed three-day plan.", time: "now", group: "TODAY", status: "done", originalContext: "Plan Montreal trip", chosenOption: "Plan Montreal trip", steps: [], outcome: "Trip plan", result: { outcome: "completed", summary: "A relaxed three-day plan.", details: "A relaxed three-day plan.", verified: false, externalChange: false, facts: [], links: [], moneySaved: null, recommendedNextStep: null, followUpActions: montrealFollowUps, blocks: montrealBlocks } },
  { id: "preview-product-results", runId: "preview-product-results-run", completedAt: "2026-09-11T12:00:00Z", category: "shopping", title: "Find pants", subtitle: "I’d pick the cinched pair.", time: "now", group: "TODAY", status: "done", originalContext: "Find gray sweatpants", chosenOption: "Find gray sweatpants", steps: [], outcome: "Found two pairs" },
  { id: "preview-call-completed", runId: "preview-call-completed-run", completedAt: "2026-09-10T12:00:00Z", category: "food", title: "Dinner booked", subtitle: "You’re booked for 7 tomorrow.", time: "now", group: "TODAY", status: "done", originalContext: "Call and book a table for two.", chosenOption: "Please call and book a table for two at 7.", steps: [], outcome: "Dinner booked" },{
  id: "preview-research-result",
  category: "food",
  title: "Your Minetta Tavern dinner was cancelled",
  subtitle: "Four live alternatives checked for Sunday dinner",
  time: "12:50 PM",
  group: "TODAY",
  status: "done",
  originalContext: "Research replacements for this restaurant for two people near 5:30 PM Sunday.",
  chosenOption: "Research replacement restaurants",
  steps: ["Research live alternatives", "Compare availability"],
  outcome: "Four replacement restaurants were compared.",
  result: {
    outcome: "completed", summary: "Four live alternatives checked for Sunday dinner", details: "Compared four restaurants with current booking evidence.", verified: true, externalChange: false,
    options: [
      { id: "lartusi", name: "L’Artusi", description: "Closest match for atmosphere and neighborhood", status: "5:00 PM indoor · 8:45 PM bar", sourceUrl: "https://resy.com/", recommended: true },
      { id: "via-carota", name: "Via Carota", description: "Italian · West Village", status: "Check live availability", sourceUrl: "https://resy.com/", recommended: false },
      { id: "i-sodi", name: "I Sodi", description: "Tuscan · West Village", status: "Check live availability", sourceUrl: "https://resy.com/", recommended: false },
      { id: "don-angie", name: "Don Angie", description: "Modern Italian · Greenwich Village", status: "Check live availability", sourceUrl: "https://resy.com/", recommended: false },
    ],
    followUpActions: [
      { id: "book-lartusi", label: "Book this", description: "Start a new task to reserve the selected option.", intent: "Book L’Artusi for two people on Sunday at 5:00 PM.", actionType: "approval", optionId: "lartusi", sourceUrl: "https://resy.com/", requiresFreshEvidence: true },
      { id: "check-lartusi-time", label: "Check another time", description: "Research current availability for this option.", intent: "Check L’Artusi for other available Sunday dinner times for two people.", actionType: "research", optionId: "lartusi", sourceUrl: "https://resy.com/", requiresFreshEvidence: true },
      { id: "compare-restaurants", label: "Compare again", description: "Refresh and compare the researched options.", intent: "Refresh availability and compare the replacement restaurant options again.", actionType: "research", optionId: null, sourceUrl: null, requiresFreshEvidence: true },
    ],
    facts: [], links: [], moneySaved: null, recommendedNextStep: null,
  },
  artifacts: [
    { id: "internal-csv", runId: "preview-research", name: "internal-options.csv", mimeType: "text/csv" },
    { id: "internal-json", runId: "preview-research", name: "internal-options.json", mimeType: "application/json" },
  ],
}, {
  id: "preview-cancellation-result",
  completedAt: "2026-09-06T14:20:00.000Z",
  runId: "preview-cancellation-run",
  category: "money",
  title: "Subscription cancelled",
  subtitle: "IconScout will not renew again.",
  time: "10:20 AM",
  group: "TODAY",
  status: "done",
  originalContext: "Cancel the IconScout subscription before its next renewal.",
  chosenOption: "Cancel the subscription",
  steps: ["Cancellation sent", "IconScout confirmed", "Renewal stopped"],
  outcome: "IconScout will not renew again.",
  moneySaved: { amount: 149, currency: "USD", cadence: "annual", basis: "Avoided the next annual renewal" },
  result: {
    outcome: "completed", summary: "IconScout will not renew again.", details: "The subscription cancellation was confirmed.", verified: true, externalChange: true,
    options: [], followUpActions: [], facts: [], links: [{ label: "Cancellation confirmation", url: "https://example.com/confirmation" }],
    moneySaved: { amount: 149, currency: "USD", cadence: "annual", basis: "Avoided the next annual renewal" }, recommendedNextStep: null,
  },
}];

export const uiPreviewLifeProfile: LifeProfileResponse = {
  requiredVersion: 1,
  profile: { homeCity: "Toronto", homeCountry: "Canada", travelMode: "drive", travelBufferMinutes: 30, goals: ["money", "travel", "life_admin"], customGoal: "Keep family forms and renewals from slipping through", profileVersion: 1 },
  facts: [
    { id: "preview-memory-1", kind: "preference", value: { content: "I prefer vegetarian restaurants." }, source: "conversation", confidence: 1, lastConfirmedAt: "2026-09-09T12:00:00Z" },
    { id: "preview-memory-2", kind: "travel_preference", value: { mode: "drive", bufferMinutes: 30 }, source: "onboarding", confidence: 1, lastConfirmedAt: new Date().toISOString() },
  ],
};

export const uiPreviewVaultItems: VaultItemSummary[] = [
  { id: "preview-login", kind: "login", label: "School portal", siteHost: "school.example", usernameHint: "mi•••@example.com", cardBrand: null, cardLast4: null, updatedAt: new Date().toISOString() },
  { id: "preview-card", kind: "payment_card", label: "Everyday card", siteHost: null, usernameHint: null, cardBrand: "Visa", cardLast4: "4242", updatedAt: new Date().toISOString() },
];


export const uiPreviewThreads: Record<string, ThreadItem[]> = {
  'preview-send-reference-run': [
    { id: 'reference-context', kind: 'agent', text: 'Here are the details from earlier.\n\n[Apple](https://www.apple.com/) and [Toronto Blue Jays](https://www.mlb.com/bluejays).\n\nThere is no rush. We can pick this up later.', createdAt: new Date(Date.parse(polishTime) - 86_400_000).toISOString() },
    { id: 'reference-update', kind: 'agent', text: 'Tour dates, Thu Sep 24: nothing new today. Omer Ramat Gan Oct 8–18, Jerusalem Dec 3 (sold out) + Dec 6. Ishay – nothing announced.', createdAt: new Date(Date.parse(polishTime) - 50_000_000).toISOString() },
    { id: 'reference-hi', kind: 'user', text: 'Hi', createdAt: polishTime, deliveredAt: polishTime, readAt: polishTime },
    { id: 'reference-reply', kind: 'agent', text: 'Hey. What’s up?', createdAt: polishTime },
  ],
  'preview-vault-summary-run': [
    { id: 'vault-summary-user', kind: 'user', text: 'Use my saved Nike account and card.' },
    { id: 'vault-summary-agent', kind: 'agent', text: 'Choose your login and card, then unlock them to continue.' },
    { id: 'vault-summary-login', kind: 'answers', compact: true, vault: { kind: 'login', label: 'Nike', detail: 'michael@example.com' }, answers: [{ question: 'Login details', answer: 'Provided securely' }] },
    { id: 'vault-summary-card', kind: 'answers', compact: true, vault: { kind: 'payment_card', label: 'Personal card', detail: 'Visa •••• 4242' }, answers: [{ question: 'Payment details', answer: 'Provided securely' }] },
    { id: 'vault-summary-done', kind: 'agent', text: 'Your login and card are ready. I’ll ask before placing the order.' },
  ],
  'preview-messages-polish-run': [
    { id: 'polish-1', kind: 'user', text: 'Any ideas for Saturday?', createdAt: new Date(Date.parse(polishTime) - 180_000).toISOString() },
    { id: 'polish-2', kind: 'agent', text: 'A slow morning and lunch outside?', createdAt: new Date(Date.parse(polishTime) - 160_000).toISOString() },
    { id: 'polish-3', kind: 'agent', text: 'There’s a little café by the park. We could walk over after coffee.', createdAt: new Date(Date.parse(polishTime) - 155_000).toISOString() },
    { id: 'polish-4', kind: 'user', text: 'That sounds good', createdAt: new Date(Date.parse(polishTime) - 120_000).toISOString() },
    { id: 'polish-5', kind: 'user', text: 'Let’s make it 12:30', createdAt: new Date(Date.parse(polishTime) - 115_000).toISOString() },
    { id: 'polish-6', kind: 'agent', text: '12:30 works. I’ll keep the afternoon free so there’s no rush.', createdAt: new Date(Date.parse(polishTime) - 80_000).toISOString() },
    { id: 'polish-7', kind: 'user', text: 'Perfect, see you there!', createdAt: polishTime, deliveredAt: polishTime },
  ],
  "preview-working-run": [
    { id: "working-user", kind: "user", text: "Find a table for two tomorrow at 7." },
    { id: "working-agent", kind: "agent", text: "I’ll check nearby restaurants." },
  ],
  "preview-montreal-blocks-run": [
    { id: "montreal-user", kind: "user", text: "Plan Montreal trip" },
    { id: "montreal-reply", kind: "agent", text: "I’d take the train and keep each day to one main outing. Dates are assumed, so confirm them before booking." },
    { id: "montreal-blocks", kind: "blocks", followUpActions: montrealFollowUps, blocks: montrealBlocks },
  ],
  "preview-product-results-run": [
    { id: "product-user", kind: "user", text: "Find gray sweatpants" },
    { id: "product-reply", kind: "agent", text: "I’d pick the cinched pair for the closer fit. [Essential Cinched Sweatpant](https://example.com/cinched) is the best match." },
    { id: "product-options", kind: "options", options: [
      { id: "cinched", name: "Essential Cinched Sweatpant", description: "$60 · Dark gray · Closest fit", sourceUrl: "https://example.com/cinched", status: "Available", recommended: true },
      { id: "baggy", name: "Essential Baggy Open-Hem", description: "$70 · Gray · Relaxed fit", sourceUrl: "https://example.com/baggy", status: "Available", recommended: false },
    ] },
  ],
  "preview-call-completed-run": [
    { id: "call-completed-user", kind: "user", text: "Please call and book a table for two at 7." },
    { id: "call-completed-answers", kind: "answers", answers: [{ question: "Which day?", answer: "Tomorrow" }] },
    { id: "call-completed-intro", kind: "agent", text: "I’ll call L’Artusi now." },
    { id: "call:preview-ended-call", kind: "call", recipient: "L’Artusi", durationSeconds: 83, failed: false },
    { id: "call-completed-agent", kind: "agent", text: "You’re booked for 7 tomorrow." },
    { id: "photo-sent-preview", kind: "user", text: "what do you think of this?", photos: [{ id: "sample-photo", url: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><rect width="300" height="600" fill="#c96542"/><circle cx="150" cy="240" r="100" fill="#ecc77a"/><path d="M0 500L150 330L300 500V600H0Z" fill="#486b55"/></svg>'), description: "Portrait photo you sent" }], deliveredAt: "2026-09-10T20:00:00Z" },
  ],
  "preview-call-run": [
    { id: "preview-call-user", kind: "user", text: "Call L’Artusi and book dinner for tomorrow." },
    { id: "preview-call-intro", kind: "agent", text: "I can help with that. I just need the booking details first." },
    { id: "preview-call-answers", kind: "answers", answers: [{ question: "What time works for you?", answer: "7:00 PM", choice: true }, { question: "How many people?", answer: "2 people", choice: true }] },
    { id: "preview-call-agent", kind: "agent", text: "I’ll call L’Artusi now and ask for a table for two tomorrow at 7." },
  ],
  "preview-wait-run": [
    { id: "preview-wait-user", kind: "user", text: "Ask Alex which evening works for dinner, then help me make a plan." },
    { id: "preview-wait-answers", kind: "answers", answers: [{ question: "Which evenings work for you?", answer: "Thursday or Friday", choice: true }] },
    { id: "preview-wait-agent", kind: "agent", text: "I’ve emailed Alex with Thursday and Friday as options. I’ll pick this up when he replies." },
  ],
  "preview-time-run": [
    { id: "preview-time-user", kind: "user", text: "Check the delivery again in an hour." },
    { id: "preview-time-agent", kind: "agent", text: "The courier hasn’t updated tracking yet. I’ll check again in an hour." },
  ],
};

/** Preview rows use the same sender-aware message contract as real conversations. */
export const uiPreviewConversationMessages: ConversationMessages = Object.fromEntries(
  [...uiPreviewTasks, ...uiPreviewHistory].flatMap(row => {
    if (!row.runId) return [];
    const thread = uiPreviewThreads[row.runId] ?? [];
    const last = thread.findLast(item => item.kind === 'user' || item.kind === 'agent');
    if (!last || (last.kind !== 'user' && last.kind !== 'agent')) return [];
    const incoming = thread.findLast(item => item.kind === 'agent');
    const fallback = ('completedAt' in row ? row.completedAt : 'updatedAt' in row ? row.updatedAt : undefined) || new Date().toISOString();
    return [[conversationKey(row.decisionId, row.runId, row.id), { kind: last.kind, text: last.text,
      createdAt: last.createdAt || fallback, incomingAt: incoming?.createdAt || fallback, unreadCount: 0 }]];
  }),
);
