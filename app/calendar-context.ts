import type { AgentRunSnapshot } from "../lib/harness/types";
import type { ThreadItem } from "../lib/harness/thread";
import type { Decision, HistoryEntry, RunningTask } from "../lib/types";

export type ConversationCalendar = { decision: Decision; date?: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
function dateValue(value: unknown): string | undefined {
  const candidate = typeof value === "string" ? value : record(value).dateTime ?? record(value).date;
  return typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(candidate) && Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
}

/** Calendar access is presentation only; it never creates an event or changes a schedule. */
export function conversationCalendar({ decision, snapshot, task, entry, items = [] }: {
  decision?: Decision; snapshot?: AgentRunSnapshot; task?: RunningTask; entry?: HistoryEntry; items?: ThreadItem[];
}): ConversationCalendar | null {
  const saved = decision ?? task?.retryDecision ?? entry?.retryDecision ?? snapshot?.metadata.retryDecision as Decision | undefined;
  const context = saved?.executionContext ?? snapshot?.metadata.executionContext as Decision["executionContext"];
  const category = saved?.category ?? task?.category ?? entry?.category ?? snapshot?.category;
  const actions = snapshot?.actions.filter(action => /^(calendar_|schedule_)/.test(action.toolName) && action.status !== "rejected") ?? [];
  const copy = [saved?.title, saved?.subtitle, task?.title, entry?.title, snapshot?.title, snapshot?.request, task?.originalContext, entry?.contextSummary,
    ...items.filter(item => item.kind === "user" || item.kind === "agent").map(item => item.text)].join(" ");
  const relevant = category === "schedule" || saved?.sourceType === "calendar" || Boolean(context?.sourceCalendar?.events.length)
    || actions.length > 0 || /\b(calendar|scheduling|reschedul\w*|remind(?:er|ers)?|appointment|meeting|availability|agenda)\b|\b(?:schedule|book|move)\s+(?:a |an |the |my |our )?(?:call|event|dinner|lunch|time|table)\b/i.test(copy);
  if (!relevant) return null;
  // Prefer the latest structured target over the original decision's date. Never parse arbitrary prose as a date.
  let date: string | undefined;
  for (const action of [...actions].reverse()) {
    const result = record(action.result);
    const schedule = record(result.schedule);
    const event = record(action.input.event);
    date = dateValue(schedule.nextRunAt) ?? dateValue(record(result.event).start) ?? dateValue(result.start)
      ?? dateValue(event.start) ?? dateValue(record(action.input.changes).start) ?? dateValue(action.input.start) ?? dateValue(record(action.input.definition).firstRunAt) ?? dateValue(action.input.firstRunAt);
    if (date) break;
  }
  return { decision: saved ?? {
    id: snapshot?.id ?? task?.id ?? entry?.id ?? "calendar-context", sourceType: "manual", category: "schedule", urgency: "low",
    title: task?.title ?? entry?.title ?? snapshot?.title ?? "Your day", subtitle: "", originalContext: "", executionContext: context,
    options: [], dismissLabel: "Not now", createdAt: snapshot?.createdAt ?? entry?.completedAt ?? "",
  }, date };
}
