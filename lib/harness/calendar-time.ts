import { createTemporalContext, validTimeZone } from "../temporal";

/** Preserve Google's event/recurrence fields; add an unambiguous display time. */
export function withCalendarLocalTime(event: Record<string, unknown>, timeZoneValue: unknown): Record<string, unknown> {
  const timeZone = validTimeZone(timeZoneValue) ?? "UTC";
  const format = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const boundary = value as { date?: unknown; dateTime?: unknown };
    // All-day dates are calendar dates, not midnight instants to convert.
    if (typeof boundary.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(boundary.date)) return { date: boundary.date, allDay: true };
    if (typeof boundary.dateTime !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(boundary.dateTime)) return null;
    const instant = new Date(boundary.dateTime);
    if (!Number.isFinite(instant.getTime())) return null;
    const local = createTemporalContext(timeZone, instant);
    return {
      dateTime: local.currentLocalDateTime,
      utc: local.currentDateTimeUtc,
      display: new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "full", timeStyle: "short" }).format(instant),
    };
  };
  return {
    ...event,
    userLocalTime: {
      timeZone,
      start: format(event.start),
      end: format(event.end),
      endExclusive: true,
      interpretation: "Use these already-converted times when speaking to the user. The offset in the original dateTime defines the instant; its sibling timeZone is event/recurrence metadata, not an instruction to reinterpret that clock time. Do not convert userLocalTime again. Null means the time could not be resolved.",
    },
  };
}
