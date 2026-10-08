import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import { validTimeZone } from "../temporal";

export const recurrenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expression: z.string().trim().max(120) }),
  z.object({ type: z.literal("interval"), minutes: z.number().int().min(1).max(525600) }),
]);
export type Recurrence = z.infer<typeof recurrenceSchema>;
export const scheduleDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(100),
  kind: z.enum(["reminder", "task", "check"]),
  instructions: z.string().trim().min(1).max(8000),
  timeZone: z.string().trim().min(1).max(100),
  firstRunAt: z.string().max(80).nullable(),
  recurrence: recurrenceSchema.nullable().describe('A real JSON object, never a quoted string: {"type":"interval","minutes":15} or {"type":"cron","expression":"0 9 * * *"}. Use explicit null for one-time work. This field is required.'),
  endAt: z.string().max(80).nullable().describe("An offset-bearing ISO end date, or JSON null (not the string null) when absent."),
  scheduleLabel: z.string().trim().min(1).max(180),
  notifyPolicy: z.enum(["always", "when_relevant"]),
});
export type ScheduleDefinition = z.infer<typeof scheduleDefinitionSchema>;

export function absoluteDate(value: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error("Use an ISO date with an explicit UTC offset, not an ambiguous local time.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid scheduled date.");
  return date;
}

export function nextOccurrence(recurrence: Recurrence, timeZone: string, after: Date, anchor: Date): Date {
  if (!validTimeZone(timeZone)) throw new Error("Use a valid IANA timezone.");
  if (recurrence.type === "interval") {
    const duration = recurrence.minutes * 60_000;
    return new Date(anchor.getTime() + Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / duration) + 1) * duration);
  }
  if (recurrence.expression.split(/\s+/).length !== 5) throw new Error("Use a five-field cron expression (minute, hour, day, month, weekday).");
  return CronExpressionParser.parse(recurrence.expression, { tz: timeZone, currentDate: after }).next().toDate();
}

export function validateDefinition(raw: ScheduleDefinition, now = new Date()) {
  const definition = scheduleDefinitionSchema.parse(raw);
  if (!validTimeZone(definition.timeZone)) throw new Error("Use a valid IANA timezone.");
  if (definition.kind !== "check" && definition.notifyPolicy !== "always") throw new Error("Reminders and tasks always deliver their result. Quiet delivery is only for checks.");
  const first = definition.firstRunAt ? absoluteDate(definition.firstRunAt) : definition.recurrence?.type === "cron"
    ? nextOccurrence(definition.recurrence, definition.timeZone, now, now)
    : null;
  if (!first) throw new Error("Specify when the first occurrence should run.");
  if (first.getTime() <= now.getTime()) throw new Error("The scheduled time is in the past. Resolve the next intended time with the user.");
  if (definition.recurrence) {
    nextOccurrence(definition.recurrence, definition.timeZone, first, first);
    if (definition.recurrence.type === "cron") {
      const expected = nextOccurrence(definition.recurrence, definition.timeZone, new Date(first.getTime() - 1), first);
      if (expected.getTime() !== first.getTime()) throw new Error("The first run time does not match the recurrence in this timezone.");
    }
  }
  const end = definition.endAt ? absoluteDate(definition.endAt) : null;
  if (end && end < first) throw new Error("The end date is before the first occurrence.");
  return { ...definition, firstRunAt: first.toISOString(), endAt: end?.toISOString() ?? null };
}

export function nextAfterDelivery(definition: ScheduleDefinition, dueAt: Date, now: Date): Date | null {
  if (!definition.recurrence) return null;
  // Missed occurrences coalesce into one delivery; never replay a backlog.
  const next = nextOccurrence(definition.recurrence, definition.timeZone, new Date(Math.max(now.getTime(), dueAt.getTime())), absoluteDate(definition.firstRunAt!));
  return definition.endAt && next > absoluteDate(definition.endAt) ? null : next;
}

export function localScheduleTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date(iso));
}
