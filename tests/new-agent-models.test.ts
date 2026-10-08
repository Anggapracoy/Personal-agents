import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from 'ai';
import { dashAnthropicModel } from '../lib/harness/anthropic-model';
import { cacheableInstructions, modelProviderOptions } from '../lib/harness/model';

test('Sonnet 5.5 serializes medium effort, stable and automatic caching, and safe reasoning replay', async () => {
  const selected = { provider: 'anthropic' as const, modelId: 'claude-sonnet-5-5', reasoningEffort: 'medium' as const };
  let captured: Record<string, any> = {};
  let headers = new Headers();
  const model = dashAnthropicModel(selected.modelId, { apiKey: 'test', fetch: async (_url, init) => {
    captured = JSON.parse(init!.body as string);
    headers = new Headers(init!.headers);
    return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: selected.modelId, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } });
  } });
  const result = await generateText({ model, instructions: cacheableInstructions(selected, 'stable policy', 'dynamic context'), prompt: 'Hello', providerOptions: modelProviderOptions(selected, 'turn', 'test'), maxRetries: 0 });
  assert.equal(result.text, 'OK');
  assert.equal(captured.model, selected.modelId);
  assert.equal(captured.output_config.effort, 'medium');
  assert.deepEqual(captured.cache_control, { type: 'ephemeral' });
  assert.deepEqual(captured.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(captured.system[1].cache_control, undefined);
  assert.deepEqual(captured.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.match(headers.get('anthropic-beta')!, /thinking-binding-controls-2026-08-01/);
});
