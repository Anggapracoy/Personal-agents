import { createHash } from "node:crypto";
import { findCalendarConflicts, type GoogleEvent } from "../google";
import type { Decision, DecisionExecutionContext } from "../types";
import { focusPriorityBonus } from "../life-memory-context";

export type ProactiveProfile = {
  homeCity: string | null;
  homeCountry: string | null;
  homeLat: number | null;
  homeLng: number | null;
  timeZone: string | null;
  travelMode: string | null;
  travelBufferMinutes: number | null;
  goals: string[];
  customGoal: string | null;
};

export type WeatherSignal = {
  date: string;
  weatherCode: number;
  precipitationProbability: number;
  windSpeedKph: number;
};

export type ProactiveCalendarServices = {
  travelSeconds: (input: { origin: string; destination: string; mode: string; departureTime: string }) => Promise<number | null>;
  weatherAtLocation: (location: string, date: string) => Promise<WeatherSignal | null>;
  weatherAtCoordinates: (latitude: number, longitude: number, date: string) => Promise<WeatherSignal | null>;
};

type SourceContext = {
  sourceKind: "google" | "device";
  connectionId: string;
  accountEmail: string;
  prefixIds: boolean;
};

const virtualLocationPattern = /\b(zoom|google meet|meet\.google|teams\.microsoft|microsoft teams|webex|facetime|online|virtual)\b/i;
const outdoorsPattern = /\b(hike|hiking|picnic|park|beach|golf|ski|skiing|run|running|walk|walking|festival|outdoor|patio|camp|camping|boat|boating|kayak|soccer|baseball|tennis|flight|helicopter)\b/i;

function eventName(event: GoogleEvent) {
  return event.summary?.trim() || "event";
}

function eventStart(event: GoogleEvent) {
  const value = event.start?.dateTime;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function eventEnd(event: GoogleEvent) {
  const value = event.end?.dateTime;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function usableTravelLocation(value: string | null | undefined) {
  const location = value?.trim();
  if (!location || location.length < 4 || virtualLocationPattern.test(location)) return null;
  return location;
}

function fingerprint(kind: string, values: string[]) {
  return `${kind}:${createHash("sha256").update(values.join("|")).digest("hex").slice(0, 20)}`;
}

function calendarExecution(events: GoogleEvent[], context: SourceContext): DecisionExecutionContext {
  return {
    sourceAccountId: context.sourceKind === "google" ? context.connectionId : undefined,
    sourceAccountEmail: context.sourceKind === "google" ? context.accountEmail : undefined,
    sourceCalendar: {
      sourceKind: context.sourceKind,
      eventIds: events.map((event) => event.id),
      events: events.map((event) => ({
        id: event.id,
        summary: eventName(event),
        description: event.description ?? "",
        location: event.location ?? "",
        start: event.start?.dateTime ?? event.start?.date ?? "",
        end: event.end?.dateTime ?? event.end?.date ?? "",
        attendees: (event.attendees ?? []).map((attendee) => attendee.email ?? attendee.displayName ?? "").filter(Boolean),
        htmlLink: event.htmlLink ?? "",
      })),
    },
  };
}

function sourceId(id: string, context: SourceContext) {
  return context.prefixIds ? `${context.connectionId}-${id}` : id;
}

function overlapDecisions(events: GoogleEvent[], context: SourceContext, now: Date) {
  return findCalendarConflicts(events).map(([first, second]): Decision => ({
    id: sourceId(`calendar-${first.id}-${second.id}`, context),
    discoveryFingerprint: fingerprint("calendar-overlap", [context.connectionId, first.id, second.id]),
    sourceType: "calendar",
    sourceLabel: context.accountEmail,
    category: "schedule",
    urgency: "high",
    title: `Which event should move: ${eventName(first)} or ${eventName(second)}?`,
    subtitle: `${eventName(first)} and ${eventName(second)} overlap\n\nwhich one should i move?`,
    originalContext: `${eventName(first)} overlaps with ${eventName(second)}.`,
    executionContext: calendarExecution([first, second], context),
    options: [
      { id: "move-first", label: `Move ${eventName(first)}`, actionType: "approval", isPrimary: true },
      { id: "move-second", label: `Move ${eventName(second)}`, actionType: "approval" },
    ],
    dismissLabel: "Leave both for now",
    createdAt: now.toISOString(),
    actionableUntil: [first.start?.dateTime, second.start?.dateTime].filter((value): value is string => Boolean(value)).sort()[0],
    whyThisAppeared: ["Two confirmed calendar events overlap.", "Moving either event is still possible."],
    evidence: [
      { claim: `${eventName(first)} is scheduled at this time.`, sourceType: "calendar", sourceLabel: context.accountEmail, sourceId: first.id },
      { claim: `${eventName(second)} is scheduled at the same time.`, sourceType: "calendar", sourceLabel: context.accountEmail, sourceId: second.id },
    ],
  }));
}

const TIME_BLOCK = /\b(?:busy|block(?:ed)?|hold|focus|do not book|dnd|ooo|out of office|travel time|commute|lunch|gym|personal)\b/i;

/** A timed event with a real title, not a placeholder block. */
function realCommitment(event: GoogleEvent) {
  return Boolean(event.start?.dateTime) && Boolean(event.summary?.trim()) && !TIME_BLOCK.test(event.summary ?? "");
}

/** The same meeting copied twice (same title) is a duplicate, not a conflict. */
function duplicateOverlap(decision: Decision, events: GoogleEvent[]) {
  const ids = decision.executionContext?.sourceCalendar?.eventIds ?? [];
  const [first, second] = ids.map((id) => events.find((event) => event.id === id));
  return Boolean(first && second && (first.summary ?? "").trim().toLowerCase() === (second.summary ?? "").trim().toLowerCase());
}

function severeWeather(signal: WeatherSignal) {
  return signal.precipitationProbability >= 70 || signal.windSpeedKph >= 50 || [65, 66, 67, 75, 77, 82, 86, 95, 96, 99].includes(signal.weatherCode);
}

function favorableWeather(signal: WeatherSignal) {
  return signal.precipitationProbability <= 25 && signal.windSpeedKph <= 28 && signal.weatherCode < 50;
}

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localMinute(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function hasThreeHourDaylightBlock(events: GoogleEvent[], day: string, timeZone: string) {
  const startMinute = 9 * 60;
  const endMinute = 19 * 60;
  const busy = events.flatMap((event) => {
    const start = eventStart(event);
    const end = eventEnd(event);
    if (start === null || end === null || dateKey(new Date(start), timeZone) !== day) return [];
    return [[Math.max(startMinute, localMinute(new Date(start), timeZone)), Math.min(endMinute, localMinute(new Date(end), timeZone))] as const];
  }).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let cursor = startMinute;
  for (const [start, end] of busy) {
    if (start - cursor >= 180) return true;
    cursor = Math.max(cursor, end);
  }
  return endMinute - cursor >= 180;
}

export async function discoverProactiveCalendarDecisions(input: {
  events: GoogleEvent[];
  profile: ProactiveProfile | null;
  context: SourceContext;
  services: ProactiveCalendarServices;
  now?: Date;
  /** Proactive engine v2: real double-bookings, excluding duplicates and time blocks. */
  includeOverlaps?: boolean;
}) {
  const now = input.now ?? new Date();
  const horizon = now.getTime() + 14 * 86_400_000;
  const events = input.events.filter((event) => {
    const start = eventStart(event);
    return start !== null && start > now.getTime() && start <= horizon;
  }).sort((a, b) => eventStart(a)! - eventStart(b)!);
  // Off by default: overlapping entries often represent duplicates or intentional time blocks.
  const decisions: Decision[] = input.includeOverlaps
    ? overlapDecisions(events.filter(realCommitment), input.context, now)
      .filter((decision) => !duplicateOverlap(decision, events))
      .map((decision) => ({ ...decision, urgency: "medium" as const }))
    : [];
  const overlappedPairs = new Set(findCalendarConflicts(events).map(([first, second]) => `${first.id}|${second.id}`));

  if (input.profile?.travelMode && input.profile.travelBufferMinutes !== null) {
    for (let index = 0; index < events.length - 1; index += 1) {
      const first = events[index]!;
      const second = events[index + 1]!;
      if (overlappedPairs.has(`${first.id}|${second.id}`)) continue;
      const origin = usableTravelLocation(first.location);
      const destination = usableTravelLocation(second.location);
      const firstEnd = eventEnd(first);
      const secondStart = eventStart(second);
      if (!origin || !destination || origin.toLowerCase() === destination.toLowerCase() || firstEnd === null || secondStart === null) continue;
      const gapSeconds = (secondStart - firstEnd) / 1_000;
      if (gapSeconds <= 0 || gapSeconds > 4 * 3_600) continue;
      const routeSeconds = await input.services.travelSeconds({
        origin,
        destination,
        mode: input.profile.travelMode,
        departureTime: new Date(firstEnd).toISOString(),
      }).catch(() => null);
      if (routeSeconds === null) continue;
      const requiredSeconds = routeSeconds + input.profile.travelBufferMinutes * 60;
      if (requiredSeconds <= gapSeconds) continue;
      const shortfallMinutes = Math.ceil((requiredSeconds - gapSeconds) / 60);
      decisions.push({
        id: sourceId(`travel-gap-${first.id}-${second.id}`, input.context),
        discoveryFingerprint: fingerprint("travel-gap", [input.context.connectionId, first.id, second.id, String(firstEnd), String(secondStart)]),
        sourceType: "proactive",
        sourceLabel: input.context.accountEmail,
        category: "schedule",
        urgency: secondStart - now.getTime() < 48 * 3_600_000 ? "high" : "medium",
        title: `You need ${shortfallMinutes} more minutes between ${eventName(first)} and ${eventName(second)}`,
        subtitle: `you're ${shortfallMinutes} minutes short getting from ${eventName(first)} to ${eventName(second)}, including your travel buffer\n\nwanna move one of them?`,
        originalContext: `${origin} to ${destination} takes about ${Math.ceil(routeSeconds / 60)} minutes, plus your ${input.profile.travelBufferMinutes}-minute buffer.`,
        executionContext: calendarExecution([first, second], input.context),
        options: [
          { id: "leave-first-early", label: `Leave ${eventName(first)} early`, actionType: "approval", isPrimary: true },
          { id: "move-second", label: `Move ${eventName(second)}`, actionType: "approval" },
        ],
        dismissLabel: "Keep the schedule",
        createdAt: now.toISOString(),
        actionableUntil: second.start?.dateTime,
        whyThisAppeared: ["These are consecutive events with different locations.", `Your ${input.profile.travelBufferMinutes}-minute buffer is included.`, "Google Routes found a real travel-time shortfall."],
        evidence: [
          { claim: `${eventName(first)} ends at ${first.end?.dateTime}.`, sourceType: "calendar", sourceLabel: input.context.accountEmail, sourceId: first.id },
          { claim: `${eventName(second)} starts at ${second.start?.dateTime}.`, sourceType: "calendar", sourceLabel: input.context.accountEmail, sourceId: second.id },
          { claim: `The route takes about ${Math.ceil(routeSeconds / 60)} minutes.`, sourceType: "route", sourceLabel: "Google Routes" },
          { claim: `Your preferred buffer is ${input.profile.travelBufferMinutes} minutes.`, sourceType: "profile", sourceLabel: "What Dash knows" },
        ],
      });
    }
  }

  {
    for (const event of events.filter((item) => eventStart(item)! <= now.getTime() + 7 * 86_400_000)) {
      const location = usableTravelLocation(event.location);
      const searchable = `${event.summary ?? ""} ${event.description ?? ""}`;
      if (!location || !outdoorsPattern.test(searchable)) continue;
      const day = event.start?.dateTime?.slice(0, 10);
      if (!day) continue;
      const weather = await input.services.weatherAtLocation(location, day).catch(() => null);
      if (!weather || !severeWeather(weather)) continue;
      decisions.push({
        id: sourceId(`weather-${event.id}-${day}`, input.context),
        discoveryFingerprint: fingerprint("weather-disruption", [input.context.connectionId, event.id, day]),
        sourceType: "proactive",
        sourceLabel: input.context.accountEmail,
        category: "schedule",
        urgency: eventStart(event)! - now.getTime() < 48 * 3_600_000 ? "high" : "medium",
        title: `Bad weather may disrupt ${eventName(event)}`,
        subtitle: `btw there's a ${weather.precipitationProbability}% chance of rain and winds up to ${Math.round(weather.windSpeedKph)} km/h during ${eventName(event)}\n\nwanna change the plan?`,
        originalContext: `${eventName(event)} is outdoors at ${location}, and the forecast now shows disruptive conditions.`,
        executionContext: calendarExecution([event], input.context),
        options: [
          { id: "reschedule", label: `Reschedule ${eventName(event)}`, actionType: "approval", isPrimary: true },
          { id: "find-backup", label: "Find an indoor backup", actionType: "research" },
        ],
        dismissLabel: "Keep the plan",
        createdAt: now.toISOString(),
        actionableUntil: event.start?.dateTime,
        whyThisAppeared: ["This looks like an outdoor plan.", "The latest forecast crossed the severe-weather threshold.", "There is still time to change the plan."],
        evidence: [
          { claim: `${eventName(event)} is scheduled at ${location}.`, sourceType: "calendar", sourceLabel: input.context.accountEmail, sourceId: event.id },
          { claim: `Forecast: ${weather.precipitationProbability}% rain chance and ${Math.round(weather.windSpeedKph)} km/h wind.`, sourceType: "weather", sourceLabel: "Open-Meteo" },
        ],
      });
    }
  }

  const profile = input.profile;
  if (profile?.customGoal && profile.homeLat !== null && profile.homeLng !== null) {
    const timeZone = profile.timeZone || "UTC";
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = new Date(now.getTime() + offset * 86_400_000);
      const day = dateKey(candidate, timeZone);
      if (!hasThreeHourDaylightBlock(events, day, timeZone)) continue;
      const weather = await input.services.weatherAtCoordinates(profile.homeLat, profile.homeLng, day).catch(() => null);
      if (!weather || !favorableWeather(weather)) continue;
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(candidate);
      const week = dateKey(new Date(now.getTime() + 7 * 86_400_000), timeZone);
      decisions.push({
        id: `goal-opportunity-${createHash("sha256").update(`${profile.customGoal}:${week}`).digest("hex").slice(0, 16)}`,
        discoveryFingerprint: fingerprint("goal-opportunity", [profile.customGoal, week]),
        sourceType: "proactive",
        category: "social",
        urgency: "low",
        title: `${weekday} has room for your goal`,
        subtitle: `you've got 3 free hours on ${weekday} and the weather looks good\n\nwanna use it for ${profile.customGoal}?`,
        originalContext: `You asked Dash to help with “${profile.customGoal}”. ${weekday} has a free daylight block and favorable local weather.`,
        options: [
          { id: "plan-goal", label: "Make a plan", actionType: "approval", isPrimary: true },
          { id: "find-ideas", label: "Find the best options", actionType: "research" },
        ],
        dismissLabel: "Not this week",
        createdAt: now.toISOString(),
        actionableUntil: new Date(candidate.getTime() + 20 * 3_600_000).toISOString(),
        whyThisAppeared: ["You explicitly asked Dash to watch this goal.", "Your calendar has a free three-hour daylight block.", "Local weather is favorable."],
        evidence: [
          { claim: `Your goal is “${profile.customGoal}”.`, sourceType: "profile", sourceLabel: "What Dash knows" },
          { claim: `${weekday} has a free daylight block.`, sourceType: "calendar", sourceLabel: input.context.accountEmail },
          { claim: "The local forecast is favorable.", sourceType: "weather", sourceLabel: "Open-Meteo" },
        ],
      });
      break;
    }
  }
  const focusAreas = input.profile?.goals ?? [];
  return decisions.sort((left, right) => (
    focusPriorityBonus({ signalType: right.category, summary: `${right.title} ${right.subtitle}` }, focusAreas)
    - focusPriorityBonus({ signalType: left.category, summary: `${left.title} ${left.subtitle}` }, focusAreas)
  ));
}

function googleTravelMode(mode: string) {
  return ({ drive: "DRIVE", transit: "TRANSIT", walk: "WALK", bike: "BICYCLE" } as Record<string, string>)[mode] ?? null;
}

async function googleRoutesTravelSeconds(input: { origin: string; destination: string; mode: string; departureTime: string }) {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY?.trim();
  const travelMode = googleTravelMode(input.mode);
  if (!apiKey || !travelMode || process.env.PROACTIVE_TRAVEL_ENABLED !== "true") return null;
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-fieldmask": "routes.duration",
    },
    body: JSON.stringify({
      origin: { address: input.origin },
      destination: { address: input.destination },
      travelMode,
      departureTime: input.departureTime,
      ...(travelMode === "DRIVE" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { routes?: Array<{ duration?: string }> };
  const match = /^(\d+(?:\.\d+)?)s$/.exec(payload.routes?.[0]?.duration ?? "");
  return match ? Math.ceil(Number(match[1])) : null;
}

async function geocode(location: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const payload = await response.json() as { results?: Array<{ latitude?: number; longitude?: number }> };
  const result = payload.results?.[0];
  return typeof result?.latitude === "number" && typeof result.longitude === "number" ? result as { latitude: number; longitude: number } : null;
}

async function openMeteoWeatherAtCoordinates(latitude: number, longitude: number, date: string) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("daily", "weather_code,precipitation_probability_max,wind_speed_10m_max");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const payload = await response.json() as { daily?: { time?: string[]; weather_code?: number[]; precipitation_probability_max?: number[]; wind_speed_10m_max?: number[] } };
  if (!payload.daily?.time?.[0]) return null;
  return {
    date: payload.daily.time[0],
    weatherCode: payload.daily.weather_code?.[0] ?? 0,
    precipitationProbability: payload.daily.precipitation_probability_max?.[0] ?? 0,
    windSpeedKph: payload.daily.wind_speed_10m_max?.[0] ?? 0,
  } satisfies WeatherSignal;
}

async function openMeteoWeatherAtLocation(location: string, date: string) {
  const place = await geocode(location);
  return place ? openMeteoWeatherAtCoordinates(place.latitude, place.longitude, date) : null;
}

export const defaultProactiveCalendarServices: ProactiveCalendarServices = {
  travelSeconds: googleRoutesTravelSeconds,
  weatherAtLocation: (location, date) => process.env.PROACTIVE_WEATHER_ENABLED === "true"
    ? openMeteoWeatherAtLocation(location, date)
    : Promise.resolve(null),
  weatherAtCoordinates: (latitude, longitude, date) => process.env.PROACTIVE_GOALS_ENABLED === "true"
    ? openMeteoWeatherAtCoordinates(latitude, longitude, date)
    : Promise.resolve(null),
};
