import type { SystemModelMessage } from 'ai';

type SelectedModel = { provider: string; modelId: string };
function supportsCacheBoundary(model: SelectedModel) {
  return model.provider === 'openai' && /^gpt-(?:5\.6|6)(?:$|[-.:])/.test(model.modelId);
}

/** Preserve instruction authority while ending the reusable prefix before changing context. */
export function discoveryInstructions(model: SelectedModel, stable: string, dynamic: string): string | SystemModelMessage[] {
  if (!supportsCacheBoundary(model)) return `${stable}\n${dynamic}`;
  return [
    { role: 'system', content: stable, providerOptions: { openai: { promptCacheBreakpoint: { mode: 'explicit' } } } },
    { role: 'system', content: dynamic },
  ];
}

export function discoveryCacheOptions(model: SelectedModel, purpose: string) {
  if (!supportsCacheBoundary(model)) return {};
  // Single-pass reviews do not need to write each changing email batch to cache.
  // Research retains automatic history caching across its tool steps.
  return { promptCacheOptions: { mode: purpose === 'research' ? 'implicit' as const : 'explicit' as const, ttl: '30m' as const } };
}
