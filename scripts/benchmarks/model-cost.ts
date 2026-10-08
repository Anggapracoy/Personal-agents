/** USD per million tokens. Verified 2026-09-26 against
 * https://developers.openai.com/api/docs/pricing (Standard; >272k long context).
 * Meta: https://dev.meta.ai/docs/pricing-rate-limits
 * Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 * Cache writes replace ordinary input cost; reasoning is included in output total.
 */
const rates: Record<string, [number, number, number, number]> = {
 'muse-spark-1.3': [1.25, .15, 1.25, 4.25],
 'claude-sonnet-5': [2, .2, 2.5, 10],
 'claude-sonnet-5-5': [2, .2, 2.5, 10],
 'gpt-6.1-sol': [2, .1, 2.5, 10],
 'gpt-6-sol': [2, .2, 2.5, 10],
 'gpt-6-luna': [.1, .01, .125, .5],
 'gpt-5.6-terra': [2, .2, 2.5, 12],
 'gpt-5.6-luna': [.2, .02, .25, 1.2],
};
export type TokenUsage = { inputTokens: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number }; outputTokens: { total?: number } };
export function modelRates(model: string) {
 const key = Object.keys(rates).find(key => model === key || model.startsWith(`${key}-20`));
 if (!key) throw new Error(`Usage pricing is not configured for ${model}.`);
 return rates[key];
}
export function costMicrousd(model: string, usage: TokenUsage, tier = 'default') {
 const [input, cache, write, output] = modelRates(model);
 const total = usage.inputTokens.total, out = usage.outputTokens.total;
 if (total === undefined || out === undefined || !Number.isSafeInteger(total) || !Number.isSafeInteger(out) || total < 0 || out < 0) throw new Error('Missing model usage totals.');
 const read = usage.inputTokens.cacheRead ?? 0, written = usage.inputTokens.cacheWrite ?? 0;
 if (![read,written].every(n => Number.isSafeInteger(n) && n >= 0) || read + written > total) throw new Error('Invalid model cache usage.');
 const long = model.startsWith('gpt-') && total > 272_000;
 const multiplier = tier === 'priority' || tier === 'fast' ? 2 : tier === 'flex' ? .5 : 1;
 return Math.ceil(((total-read-written)*input*(long?2:1) + read*cache*(long?2:1) + written*write*(long?2:1) + out*output*(long?1.5:1))*multiplier);
}

