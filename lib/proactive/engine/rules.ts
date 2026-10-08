import { createTemporalContext } from "../../temporal";
import type { Decision } from "../../types";

type CategoryFeedback = Record<string, { yes: number; no: number }>;
export type ProactivePreferences = { mutedSenders: string[]; mutedTopics: string[]; categoryFeedback: CategoryFeedback };
export const defaultProactivePreferences: ProactivePreferences = { mutedSenders: [], mutedTopics: [], categoryFeedback: {} };

export function localClock(timeZone: string | null | undefined, now = new Date()) {
  const temporal = createTemporalContext(timeZone ?? 'UTC', now);
  const [hour, minute] = temporal.currentLocalDateTime.slice(11, 16).split(':').map(Number);
  return { localDate: temporal.currentLocalDate, hour: hour!, minutes: hour! * 60 + minute! };
}

export function senderAddress(from: string | undefined) {
  const match = from?.match(/<([^>]+)>/)?.[1] ?? from ?? '';
  return match.trim().toLowerCase();
}

/** Muted senders and "less like this" topics are removed before anything reaches Home. */
export function mutedByPreferences(decision: Pick<Decision, 'category' | 'sourceLabel' | 'executionContext'>, preferences: Pick<ProactivePreferences, 'mutedSenders' | 'mutedTopics'>) {
  const sender = senderAddress(decision.executionContext?.sourceEmail?.from);
  if (sender && preferences.mutedSenders.includes(sender)) return true;
  const topic = topicKey(decision);
  return preferences.mutedTopics.includes(topic);
}

export function topicKey(decision: Pick<Decision, 'category' | 'sourceLabel'>) {
  return `${decision.category}:${(decision.sourceLabel ?? '').trim().toLowerCase()}`;
}
