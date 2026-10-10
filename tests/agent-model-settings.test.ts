import assert from 'node:assert/strict';
import test from 'node:test';
import { agentModelSettingsSchema, agentModelMetadata, defaultAgentModelSettings } from '../lib/agent-model-settings';

test('shared model settings support the supported models and three reasoning levels', () => {
  assert.deepEqual(defaultAgentModelSettings, { modelId: 'gemini-3.7-flash', provider: 'google', reasoningEffort: 'medium', fastMode: false, revision: 0 });
  for (const modelId of ['muse-spark-1.3', 'gemini-3.7-flash', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'claude-sonnet-5-5']) for (const reasoningEffort of ['low', 'medium', 'high']) {
    const settings = agentModelSettingsSchema.parse({ modelId, reasoningEffort, revision: 1 });
    assert.deepEqual(agentModelMetadata(settings), { modelId, reasoningEffort, fastMode: false, modelProvider: modelId === 'muse-spark-1.3' ? 'meta' : modelId.startsWith('gemini-') ? 'google' : modelId === 'claude-sonnet-5-5' ? 'anthropic' : 'openai' });
  }
  for (const bad of [{ modelId: 'model with spaces' }, { provider: 'unknown-provider' }, { reasoningEffort: 'xhigh' }, { revision: -1 }]) assert.equal(agentModelSettingsSchema.safeParse({ ...defaultAgentModelSettings, ...bad }).success, false);
});
test('fast mode applies only to Luna and old settings default to standard', () => {
  for (const modelId of ['gpt-6-luna', 'gpt-6-sol', 'muse-spark-1.3']) {
    const settings = agentModelSettingsSchema.parse({ modelId, reasoningEffort: 'medium', revision: 0, fastMode: true });
    assert.equal(agentModelMetadata(settings).fastMode, modelId === 'gpt-6-luna');
  }
  assert.equal(agentModelSettingsSchema.parse({ modelId: 'gpt-6-luna', reasoningEffort: 'medium', revision: 0 }).fastMode, false);
});
