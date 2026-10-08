import assert from "node:assert/strict";
import test from "node:test";
import { createTemporalContext, validTimeZone } from "../lib/temporal";

test("temporal context includes authoritative UTC and user-local time", () => {
  const context = createTemporalContext("America/New_York", new Date("2026-08-12T14:05:06.000Z"));
  assert.deepEqual(context, {
    currentDateTimeUtc: "2026-08-12T14:05:06.000Z",
    userTimeZone: "America/New_York",
    currentLocalDateTime: "2026-08-12T10:05:06",
    currentLocalDate: "2026-08-12",
    currentLocalWeekday: "Wednesday",
  });
});

test("temporal context rejects invalid client timezones and safely falls back to UTC", () => {
  assert.equal(validTimeZone("Not/A_Timezone"), null);
  assert.equal(createTemporalContext("Not/A_Timezone", new Date("2026-08-12T14:05:06.000Z")).userTimeZone, "UTC");
});
