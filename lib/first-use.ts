import type { Decision } from './types';

export const starterTasks = [
  { key: 'first-task', label: 'One thing to handle', title: 'One less thing', question: 'What’s one thing you need to get done this week?', category: 'social', goal: 'Help me get one real thing done this week. Turn the thing I name into a concrete useful outcome, without requiring me to write a detailed prompt.' },
  { key: 'shopping', label: 'Find something I need to buy', title: 'Find something', question: 'What are you looking to buy?', category: 'shopping', goal: 'Help me find something to buy. Research useful options and prices once you know what I need.' },
  { key: 'plan', label: 'Make a plan', title: 'Make a plan', question: 'What’s the occasion?', category: 'social', goal: 'Help me make a plan. Turn my occasion into a concrete, useful plan.' },
  { key: 'subscription', label: 'Sort out a subscription', title: 'Subscription', question: 'Which subscription do you want to sort out?', category: 'money', goal: 'Help me sort out a subscription. Find out what I want to change before taking any action.' },
] as const;
export type StarterKey = typeof starterTasks[number]['key'];
export function starterForDecision(decision: Pick<Decision, 'id' | 'sourceType'>) {
  return decision.sourceType === 'manual' ? starterTasks.find(task => decision.id.startsWith(`starter:${task.key}:`)) : undefined;
}
export function starterDecision(key: StarterKey, id = crypto.randomUUID(), now = new Date().toISOString()): Decision {
  const task = starterTasks.find(task => task.key === key)!;
  return { id: `starter:${key}:${id}`, sourceType: 'manual', category: task.category, urgency: 'medium', title: task.title, subtitle: task.question, originalContext: task.goal, options: [], dismissLabel: 'Not now', createdAt: now };
}
export function starterRequest(decision: Decision, answer: string) {
  const task = starterForDecision(decision);
  return task ? `${task.goal}\nYou asked: ${task.question}\nMy answer: ${answer}\nUse this answer to begin. Ask only the next essential missing detail, one short question at a time. Do useful research as soon as enough information is available. Do not repeat an answered question or assume preferences or approval.` : answer;
}

export function firstUseFallbackEligible(input: { firstUse: boolean; ready: boolean; visibleCount: number; scanning: boolean; scanFinished: boolean; sourceConnected: boolean; sourcesLoaded: boolean }) {
  return input.firstUse && input.ready && input.visibleCount === 0 && !input.scanning && (input.scanFinished || (!input.sourceConnected && input.sourcesLoaded));
}
