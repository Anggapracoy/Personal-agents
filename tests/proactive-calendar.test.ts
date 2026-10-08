import assert from "node:assert/strict";
import test from "node:test";
import { discoverProactiveCalendarDecisions, usableTravelLocation, type ProactiveCalendarServices, type ProactiveProfile } from "../lib/proactive/calendar-decisions";
import type { GoogleEvent } from "../lib/google";
import type { Decision } from "../lib/types";

const now = new Date("2026-08-16T12:00:00.000Z");
const context = { sourceKind: "google" as const, connectionId: "google-1", accountEmail: "me@example.com", prefixIds: false };
const profile: ProactiveProfile = {
  homeCity: "Toronto",
  homeCountry: "Canada",
  homeLat: 43.65,
  homeLng: -79.38,
  timeZone: "America/Toronto",
  travelMode: "transit",
  travelBufferMinutes: 30,
  goals: [],
  customGoal: null,
};

function services(overrides: Partial<ProactiveCalendarServices> = {}): ProactiveCalendarServices {
  return {
    travelSeconds: async () => null,
    weatherAtLocation: async () => null,
    weatherAtCoordinates: async () => null,
    ...overrides,
  };
}

test("virtual meeting links are not treated as physical travel locations", () => {
  assert.equal(usableTravelLocation("Zoom meeting"), null);
  assert.equal(usableTravelLocation("https://meet.google.com/abc-defg-hij"), null);
  assert.equal(usableTravelLocation("100 Queen St W, Toronto"), "100 Queen St W, Toronto");
});

test("consecutive events become actionable only when route plus buffer exceeds the gap", async () => {
  const events: GoogleEvent[] = [
    { id: "first", summary: "Client meeting", location: "100 Queen St W, Toronto", start: { dateTime: "2026-08-17T13:00:00Z" }, end: { dateTime: "2026-08-17T14:00:00Z" } },
    { id: "second", summary: "Dentist", location: "2500 Yonge St, Toronto", start: { dateTime: "2026-08-17T14:45:00Z" }, end: { dateTime: "2026-08-17T15:30:00Z" } },
  ];
  const decisions = await discoverProactiveCalendarDecisions({
    events,
    profile,
    context,
    now,
    services: services({ travelSeconds: async () => 35 * 60 }),
  });
  const conflict = decisions.find((decision) => decision.id.includes("travel-gap"));
  assert.ok(conflict);
  assert.deepEqual(conflict.options.map((option) => option.label), ["Leave Client meeting early", "Move Dentist"]);
  assert.match(conflict.title, /20 more minutes/);
  assert.ok(conflict.evidence?.some((item) => item.sourceType === "route"));
});

test("a booking alone produces no weather card, but a verified outdoor disruption does", async () => {
  const event: GoogleEvent = { id: "hike", summary: "Hike at Rouge Park", location: "Rouge National Urban Park", start: { dateTime: "2026-08-18T14:00:00Z" }, end: { dateTime: "2026-08-18T17:00:00Z" } };
  const calm = await discoverProactiveCalendarDecisions({
    events: [event], profile, context, now,
    services: services({ weatherAtLocation: async () => ({ date: "2026-08-18", weatherCode: 1, precipitationProbability: 10, windSpeedKph: 8 }) }),
  });
  assert.equal(calm.some((decision) => decision.id.includes("weather")), false);

  const storm = await discoverProactiveCalendarDecisions({
    events: [event], profile, context, now,
    services: services({ weatherAtLocation: async () => ({ date: "2026-08-18", weatherCode: 95, precipitationProbability: 85, windSpeedKph: 55 }) }),
  });
  const card = storm.find((decision) => decision.id.includes("weather"));
  assert.ok(card);
  assert.deepEqual(card.options.map((option) => option.label), ["Reschedule Hike at Rouge Park", "Find an indoor backup"]);
});

function decision(id: string, urgency: Decision["urgency"], createdAt = now.toISOString()): Decision {
  return { id, sourceType: "proactive", category: "schedule", urgency, title: id, subtitle: id, originalContext: id, options: [], dismissLabel: "Dismiss", createdAt };
}

test("automatic overlaps never create suggestions for duplicate birthdays or intentional time blocks", async () => {
 const events: GoogleEvent[] = [
  {id:'birthday-1',summary:'Birthday',start:{date:'2026-08-17'},end:{date:'2026-08-18'}},
  {id:'birthday-2',summary:'Birthday',start:{date:'2026-08-17'},end:{date:'2026-08-18'}},
  {id:'class',summary:'Class',start:{dateTime:'2026-08-17T13:00:00Z'},end:{dateTime:'2026-08-17T15:00:00Z'}},
  {id:'code',summary:'Code',start:{dateTime:'2026-08-17T13:30:00Z'},end:{dateTime:'2026-08-17T14:30:00Z'}},
 ];
 const decisions=await discoverProactiveCalendarDecisions({events,profile:null,context,now,services:services()});
 assert.deepEqual(decisions,[]);
});
