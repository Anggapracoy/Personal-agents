import { createHash } from 'node:crypto';
import type { Category, Decision, DecisionOption } from '../../types';

export function engineDecisionId(ownerEmail: string, kind: string, key: string) {
  return `proactive-${kind}-${createHash('sha256').update(`${ownerEmail.toLowerCase()}:${kind}:${key}`).digest('hex').slice(0, 20)}`;
}

/** Engine cards use the same chat-card format as every other suggestion on Home. */
export function engineDecision(input: {
  ownerEmail: string; kind: string; key: string; category: Category; title: string; body: string;
  why: string[]; context: Record<string, unknown>; options: Array<Omit<DecisionOption, 'id'>>;
  urgency?: Decision['urgency']; actionableUntil?: Date; sourceType?: Decision['sourceType']; sourceLabel?: string;
  executionContext?: Decision['executionContext']; dismissLabel?: string; now?: Date;
}): Decision {
  const now = input.now ?? new Date();
  return {
    id: engineDecisionId(input.ownerEmail, input.kind, input.key),
    discoveryFingerprint: `proactive:${input.kind}:${input.key}`,
    sourceType: input.sourceType ?? 'proactive', category: input.category, urgency: input.urgency ?? 'medium', title: input.title, subtitle: input.body, sourceLabel: input.sourceLabel ?? 'For you',
    whyThisAppeared: input.why, originalContext: JSON.stringify(input.context), executionContext: input.executionContext,
    options: input.options.map((option, index) => ({ ...option, id: `option-${index + 1}`, isPrimary: index === 0 })),
    dismissLabel: input.dismissLabel ?? 'Not now', createdAt: now.toISOString(),
    ...(input.actionableUntil ? { actionableUntil: input.actionableUntil.toISOString() } : {}),
  };
}
