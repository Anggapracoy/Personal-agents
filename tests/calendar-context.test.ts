import assert from "node:assert/strict";
import test from "node:test";
import { conversationCalendar } from "../app/calendar-context";
import type { AgentRunSnapshot } from "../lib/harness/types";
import type { Decision } from "../lib/types";
const decision: Decision = { id: "event", sourceType: "calendar", category: "schedule", urgency: "low", title: "Move our meeting?", subtitle: "", originalContext: "", options: [], dismissLabel: "Not now", createdAt: "2026-09-06T12:00:00Z", executionContext: { sourceAccountId: "work", sourceCalendar: { eventIds: ["meeting"], events: [{ id: "meeting", summary: "Meeting", description: "", location: "", start: "2026-09-08T14:00:00Z", end: "2026-09-08T15:00:00Z", attendees: [], htmlLink: "" }] } } };
function run(overrides: Partial<AgentRunSnapshot> = {}): AgentRunSnapshot {
 return { id: "run", userId: "test", decisionId: null, category: "social", request: "Hello", title: "Chat", response: "", result: null, status: "done", metadata: {}, error: null, createdAt: "2026-09-06T12:00:00Z", updatedAt: "2026-09-06T12:00:00Z", completedAt: null, actions: [], artifacts: [], ...overrides };
}
test("keeps the original calendar and account after a scheduling decision leaves Home", () => {
 const context = conversationCalendar({ snapshot: run({ metadata: { retryDecision: decision } }) });
 assert.equal(context?.decision, decision);
 assert.equal(context?.decision.executionContext?.sourceAccountId, "work");
});
test("a scheduling follow-up adds day access to an ordinary chat without inventing a date", () => {
 assert.equal(conversationCalendar({ snapshot: run() }), null);
 const context = conversationCalendar({ snapshot: run(), items: [{ id: "reply", kind: "user", text: "Remind me to stretch tomorrow" }] });
 assert.ok(context);
 assert.equal(context.date, undefined);
 assert.deepEqual(context.decision.options, []);
});
test("opens the saved reminder target even when the run category is social", () => {
 const snapshot = run();
 snapshot.actions.push({ id: "a", runId: "run", stepId: null, toolName: "schedule_create", risk: "write_reversible", preview: "", input: {}, result: { schedule: { nextRunAt: "2026-09-10T13:00:00-04:00" } }, status: "executed", approvedBy: null, approvedAt: null, executedAt: null });
 assert.equal(conversationCalendar({ snapshot })?.date, "2026-09-10T13:00:00-04:00");
});
test("a rescheduled event overrides the source date and retains calendar context", () => {
 const snapshot = run({ metadata: { retryDecision: decision } });
 snapshot.actions.push({ id: "a", runId: "run", stepId: null, toolName: "calendar_update_event", risk: "write_external", preview: "", input: { changes: { start: { dateTime: "2026-09-12T14:00:00Z" } } }, result: null, status: "proposed", approvedBy: null, approvedAt: null, executedAt: null });
 assert.equal(conversationCalendar({ snapshot })?.date, "2026-09-12T14:00:00Z");
 snapshot.actions[0].status = "rejected";
 assert.equal(conversationCalendar({ snapshot })?.date, undefined);
});
test("scheduling chats can open today before a specific day has been chosen", () => {
 assert.ok(conversationCalendar({ snapshot: run({ category: "schedule" }) }));
 assert.equal(conversationCalendar({ snapshot: run({ request: "What is the time complexity of sorting?" }) }), null);
});
