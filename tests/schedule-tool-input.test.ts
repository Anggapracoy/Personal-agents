import assert from "node:assert/strict";
import test from "node:test";
import { streamText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { scheduleCreateInputSchema, scheduleUpdateInputSchema } from "../lib/schedules/tool-input";
import { validateDefinition } from "../lib/schedules/timing";

const definition = { title: "Game result", kind: "check", instructions: "Notify only when the game is final", timeZone: "America/Toronto", firstRunAt: "2026-09-15T20:45:00-04:00", recurrence: { type: "interval", minutes: 15 }, endAt: "2026-09-16T06:00:00-04:00", scheduleLabel: "Every 15 minutes until final", notifyPolicy: "when_relevant" };

for (const recurrence of ['{"type": "interval", "minutes": 15}', '{"minutes": 15, "type": "interval"}', definition.recurrence]) {
  test(`SDK executes the recovered game check with canonical input: ${JSON.stringify(recurrence)}`, async () => {
    let executions = 0;
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "tool-call", toolCallId: "schedule", toolName: "schedule_create", input: JSON.stringify({ ...definition, recurrence }) });
      controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } });
      controller.close();
    } }) }) });
    const result = streamText({ model, prompt: "Ping me when the game ends", tools: { schedule_create: tool({ inputSchema: scheduleCreateInputSchema, execute: async input => {
      executions++;
      assert.deepEqual(input.recurrence, { type: "interval", minutes: 15 });
      const validated = validateDefinition(input, new Date("2026-09-16T00:28:00Z"));
      assert.equal(validated.firstRunAt, "2026-09-16T00:45:00.000Z");
      return { saved: true };
    } }) } });
    await result.consumeStream();
    assert.equal(executions, 1);
    assert.equal((await result.toolResults).length, 1);
  });
}

test("missing or invalid recurrence is rejected without guessing a one-time schedule", async () => {
  for (const recurrence of [undefined, '{bad json', '{"type":"interval","minutes":0}', '{"type":"interval","minutes":"15"}', '[]', '"null"']) {
    const result = await scheduleCreateInputSchema.validate!({ ...definition, recurrence, endAt: "null" });
    assert.equal(result.success, false, JSON.stringify(recurrence));
  }
});

test("explicit null and serialized cron are decoded, with date safety unchanged", async () => {
  const result = await scheduleCreateInputSchema.validate!({ ...definition, recurrence: "null", endAt: "null" });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.value.recurrence, null);
  assert.equal(result.value.endAt, null);
  assert.throws(() => validateDefinition(result.value, new Date("2026-09-17T00:00:00Z")), /past/);
  assert.throws(() => validateDefinition({ ...result.value, timeZone: "Invalid/Zone" }), /timezone/);
  const cron = await scheduleCreateInputSchema.validate!({ ...definition, firstRunAt: null, recurrence: JSON.stringify({ type: "cron", expression: "0 9 * * *" }) });
  assert.equal(cron.success, true);
});

test("schedule updates use the same recovery without altering cancel-only updates", async () => {
  const base = { id: "00000000-0000-4000-8000-000000000001", status: null };
  const result = await scheduleUpdateInputSchema.validate!({ ...base, definition: { ...definition, recurrence: JSON.stringify(definition.recurrence) } });
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(result.value.definition?.recurrence, definition.recurrence);
  const cancel = await scheduleUpdateInputSchema.validate!({ ...base, status: "cancelled", definition: null });
  assert.equal(cancel.success, true);
});

test("provider schema exposes recurrence and nullable fields with explicit types", async () => {
  const schema = await scheduleCreateInputSchema.jsonSchema;
  const properties = schema.properties as Record<string, any>;
  assert.deepEqual(properties.recurrence.type, ["object", "null"]);
  assert.deepEqual(properties.recurrence.properties.type.enum, ["cron", "interval"]);
  assert.deepEqual(properties.endAt.type, ["string", "null"]);
  assert.doesNotMatch(JSON.stringify(schema), /"(?:anyOf|oneOf)"/);
  const update = await scheduleUpdateInputSchema.jsonSchema;
  assert.doesNotMatch(JSON.stringify(update), /"(?:anyOf|oneOf)"/);
  for (const recurrence of [{ type: "cron" }, { type: "interval" }, { type: "weekly", minutes: 15 }]) {
    assert.equal((await scheduleCreateInputSchema.validate!({ ...definition, recurrence })).success, false);
  }
});
