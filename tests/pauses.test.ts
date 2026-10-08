import assert from "node:assert/strict";
import test from "node:test";
import { validatePause, pauseSchema, type PauseDefinition, type EventBaseline } from "../lib/pauses/definition";
import { incomingReply, createdEvent } from "../lib/pauses/events";
import { taskFromRun } from "../app/workspace-model";
import { MemoryRunStore } from "../lib/harness/store";
import { runAgent } from "../lib/harness/run";

const now = new Date("2026-09-06T12:00:00Z");
const definition: PauseDefinition = { reason: "Waiting for the reply", resumeInstructions: "Read the reply and finish the comparison.", condition: { type: "time", hours: 2, minutes: 15 } };
test("pause has exactly time/event modes and validates duration and calendar window", () => {
  assert.equal(validatePause(definition, now).wakeAt, "2026-09-06T14:15:00.000Z");
  assert.throws(() => validatePause({ ...definition, condition: { type: "time", hours: 0, minutes: 0 } }, now), /at least one minute/);
  assert.equal(pauseSchema.safeParse({ ...definition, condition: { type: "time", hours: -1, minutes: 1 } }).success, false);
  assert.equal(pauseSchema.safeParse({ ...definition, condition: { type: "time", hours: 1, minutes: 60 } }).success, false);
  assert.equal(pauseSchema.safeParse({ ...definition, condition: { type: "webhook", url: "https://example.com" } }).success, false);
  assert.throws(() => validatePause({ ...definition, condition: { type: "event", event: { kind: "calendar_event_created", connectionId: null, title: "Dentist", timeMin: "2026-09-07T00:00:00Z", timeMax: "2026-09-06T00:00:00Z" } } }, now), /calendar window/);
});
const baseline: EventBaseline = { ids: ["old"], since: now.toISOString(), accountEmail: "me@example.com" };
const emailCondition = { kind: "gmail_reply" as const, connectionId: null, threadId: "thread-one", afterMessageId: null, sender: "person@example.com" };
const mail = (id: string, from = "Person <person@example.com>", labelIds: string[] = ["INBOX"], internalDate = String(now.getTime() + 1000)) => ({ id, internalDate, labelIds, payload: { headers: [{ name: "From", value: from }] } });
test("email wake ignores old, sent, draft, spam, self and wrong-sender messages", () => {
  const unrelated = [mail("old"), mail("stale", undefined, undefined, String(now.getTime() - 1)), mail("sent", undefined, ["SENT"]), mail("draft", undefined, ["DRAFT"]), mail("spam", undefined, ["SPAM"]), mail("self", "me@example.com"), mail("other", "other@example.com")];
  assert.equal(incomingReply(unrelated, emailCondition, baseline), undefined);
  assert.equal(incomingReply([...unrelated, mail("new")], emailCondition, baseline)?.id, "new");
  assert.equal(incomingReply([mail("other", "other@example.com")], { ...emailCondition, sender: null }, baseline)?.id, "other");
});
test("calendar wake requires a new event with exact title inside the requested window", () => {
  const condition = { kind: "calendar_event_created" as const, connectionId: null, title: "Dentist", timeMin: "2026-09-07T12:00:00Z", timeMax: "2026-09-07T15:00:00Z" };
  const event = { id: "new", summary: " Dentist ", created: "2026-09-06T12:01:00Z", start: { dateTime: "2026-09-07T13:00:00Z" } };
  const invalid = [{ ...event, id: "old" }, { ...event, created: "2026-09-06T11:59:59Z" }, { ...event, summary: "Dentist follow-up" }, { ...event, status: "cancelled" }, { ...event, start: { dateTime: "2026-09-07T15:00:00Z" } }];
  assert.equal(createdEvent(invalid, condition, baseline), undefined);
  assert.equal(createdEvent([...invalid, event], condition, baseline)?.id, "new");
});
test("automatic wait stops the loop, remains replyable after checkpoint, and does not show approval", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "owner@example.com", decisionId: null, category: "social", request: "Wait for a reply", title: "Get a reply", metadata: {} });
  const pause = { id: crypto.randomUUID(), reason: "Waiting for their reply", ready: false, wakeAt: null, eventKind: "gmail_reply" };
  await runAgent({ runId: run.id, store, model: { turn: async () => { await store.updateRunMetadata(run.id, { automaticPause: pause }); await store.updateRun(run.id, { status: "paused" }); } } });
  assert.equal((await store.getRun(run.id))?.status, "paused");
  assert.equal(await store.claimRunForReply(run.id), false);
  await store.updateRunMetadata(run.id, { automaticPause: { ...pause, ready: true } });
  const task = taskFromRun((await store.getSnapshot(run.id))!);
  assert.equal(task.status, "waiting");
  assert.equal(task.subtitle, pause.reason);
  assert.equal(task.estimate, "Waiting");
  assert.equal(await store.claimRunForReply(run.id), true);
  assert.equal((await store.getRun(run.id))?.metadata.automaticPause, undefined);
});

test("email waits enforce a default deadline and allow an explicit bounded override", () => {
  const make = (timeoutMinutes?: number | null): PauseDefinition => ({ ...definition, condition: { type: "event", event: { ...emailCondition, timeoutMinutes } } });
  assert.equal(validatePause(make(), now).wakeAt, "2026-09-08T12:00:00.000Z");
  assert.equal(validatePause(make(null), now).wakeAt, "2026-09-08T12:00:00.000Z");
  assert.equal(validatePause(make(30), now).wakeAt, "2026-09-06T12:30:00.000Z");
  for (const invalid of [0, -1, 0.5, 43201, Infinity]) assert.throws(() => validatePause(make(invalid), now));
});
