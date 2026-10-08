import { openai } from '@ai-sdk/openai';
import { discoveryCacheOptions, discoveryInstructions } from '../../discovery/prompt-cache';

export const PROACTIVE_MODEL_ID = 'gpt-6-luna';
const selected = { provider: 'openai' as const, modelId: PROACTIVE_MODEL_ID };

/** Loose safety ceiling against runaway loops; the prompt, not this number, keeps tool use low. */
export const PROACTIVE_MAX_STEPS = 12;
export const PROACTIVE_DEADLINE_MS = 120_000;

export function proactiveModel() {
  return openai(PROACTIVE_MODEL_ID);
}

/**
 * Every proactive call sets these explicitly: low reasoning, the standard tier (never
 * priority/fast), no stored responses, and prompt caching on the stable prefix.
 */
export function proactiveProviderOptions() {
  return {
    openai: {
      ...discoveryCacheOptions(selected, 'research'),
      reasoningEffort: 'low' as const,
      reasoningSummary: null,
      serviceTier: 'default' as const,
      store: false,
    },
  };
}

/** Stable instructions are cached; per-user context follows the cache breakpoint. */
export function proactiveSystem(stable: string, dynamic: string) {
  return discoveryInstructions(selected, stable, dynamic);
}

export const toolUseGuidance = [
  'Use a tool only when the evidence you were given cannot settle the decision.',
  'Most decisions need no tools. Never look something up just to be thorough.',
  'Stop as soon as you can decide, and never repeat a lookup you already made.',
].join(' ');
