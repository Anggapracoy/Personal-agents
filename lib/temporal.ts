export type TemporalContext = {
  currentDateTimeUtc: string;
  userTimeZone: string;
  currentLocalDateTime: string;
  currentLocalDate: string;
  currentLocalWeekday: string;
};

export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return null;
  }
}

function zonedParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function createTemporalContext(timeZoneValue?: unknown, now = new Date()): TemporalContext {
  const userTimeZone = validTimeZone(timeZoneValue) ?? "UTC";
  const parts = zonedParts(now, userTimeZone);
  const currentLocalDate = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    currentDateTimeUtc: now.toISOString(),
    userTimeZone,
    currentLocalDateTime: `${currentLocalDate}T${parts.hour}:${parts.minute}:${parts.second}`,
    currentLocalDate,
    currentLocalWeekday: new Intl.DateTimeFormat("en-US", { timeZone: userTimeZone, weekday: "long" }).format(now),
  };
}

export function temporalPrompt(context: TemporalContext) {
  return [
    "Authoritative temporal context:",
    `- Current UTC datetime: ${context.currentDateTimeUtc}`,
    `- User timezone: ${context.userTimeZone}`,
    `- Current local datetime: ${context.currentLocalDateTime} (${context.currentLocalWeekday})`,
    "Resolve relative dates such as today, tomorrow, and next Monday using the user's local datetime.",
    "For Calendar results, use userLocalTime when provided: it is computed from the timestamp instant in the user timezone and must not be converted again. Otherwise respect the explicit numeric offset or Z in dateTime; a sibling timeZone does not replace that offset. Prefer the source timestamp over a conflicting time in an earlier assistant reply.",
    "Before treating a deadline, trip, booking, meeting, invitation, offer, or scheduled action as actionable, compare its relevant end/departure/deadline time with the current local datetime.",
    "A completed or expired situation is not actionable merely because an old message describes it. Only act on a past situation when current evidence establishes a concrete unresolved consequence such as a refund, claim, dispute, follow-up, missed payment, or recovery action.",
  ].join("\n");
}
