import assert from "node:assert/strict";
import test from "node:test";
import { withCalendarLocalTime } from "../lib/harness/calendar-time";

function local(event: Record<string, unknown>, zone: unknown) {
  return withCalendarLocalTime(event, zone).userLocalTime as { timeZone: string; start: { dateTime?: string; utc?: string; date?: string; allDay?: boolean } | null; end: { dateTime?: string; date?: string } | null; endExclusive: boolean };
}

test("Calendar uses the timestamp offset despite a different event timezone", () => {
  const event = { start: { dateTime: "2026-09-14T18:00:00-04:00", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-09-14T18:30:00-04:00", timeZone: "America/Los_Angeles" } };
  const result = local(event, "America/Toronto");
  assert.equal(result.start?.dateTime, "2026-09-14T18:00:00");
  assert.equal(result.end?.dateTime, "2026-09-14T18:30:00");
  assert.equal(result.start?.utc, "2026-09-14T22:00:00.000Z");
  assert.deepEqual(withCalendarLocalTime(event, "America/Toronto").start, event.start);
  assert.equal(local(event, "America/Los_Angeles").start?.dateTime, "2026-09-14T15:00:00");
});

test("Calendar converts actual Pacific offsets and UTC across local dates and DST", () => {
  assert.equal(local({ start: { dateTime: "2026-09-14T18:00:00-07:00" } }, "America/Toronto").start?.dateTime, "2026-09-14T21:00:00");
  assert.equal(local({ start: { dateTime: "2026-09-15T01:00:00Z" } }, "America/Toronto").start?.dateTime, "2026-09-14T21:00:00");
  assert.equal(local({ start: { dateTime: "2026-11-01T05:30:00Z" }, end: { dateTime: "2026-11-01T06:30:00Z" } }, "America/Toronto").end?.dateTime, "2026-11-01T01:30:00");
  assert.equal(local({ start: { dateTime: "2026-03-08T07:30:00Z" } }, "America/Toronto").start?.dateTime, "2026-03-08T03:30:00");
});

test("Calendar leaves all-day dates and exclusive ends intact", () => {
  const result = local({ start: { date: "2026-09-14" }, end: { date: "2026-09-16" } }, "America/Los_Angeles");
  assert.deepEqual(result.start, { date: "2026-09-14", allDay: true });
  assert.deepEqual(result.end, { date: "2026-09-16", allDay: true });
  assert.equal(result.endExclusive, true);
});

test("Calendar does not guess offsetless or invalid instants; invalid zones use explicit UTC", () => {
  for (const dateTime of ["2026-09-14T18:00:00", "garbageZ", ""]) assert.equal(local({ start: { dateTime, timeZone: "America/Los_Angeles" } }, "America/Toronto").start, null);
  const result = local({ start: { dateTime: "2026-09-14T18:00:00-04:00" } }, "invalid");
  assert.equal(result.timeZone, "UTC");
  assert.equal(result.start?.dateTime, "2026-09-14T22:00:00");
});
