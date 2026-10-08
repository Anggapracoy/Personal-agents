import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultModelSettings, modelDefaultVersion, supportedModelSettings } from '../app/workspace-model';
import { resolveModelSelection, modelProviderOptions } from '../lib/harness/model';
import { compactModelMessages } from '../lib/harness/context-compaction';

test('new runs and old default preferences select Muse, while explicit current choices survive', () => {
  assert.deepEqual(resolveModelSelection({metadata: {}}), {provider: 'meta', modelId: 'muse-spark-1.3'});
  assert.equal(defaultModelSettings.modelId, 'muse-spark-1.3');
  for (const modelId of ['gpt-5.6-terra', 'gpt-5.6-luna']) {
    assert.deepEqual(supportedModelSettings({provider:'openai', modelId, defaultVersion:2}), defaultModelSettings);
    assert.equal(supportedModelSettings({provider:'openai', modelId, defaultVersion:modelDefaultVersion})?.modelId, modelId);
  }
  assert.equal(supportedModelSettings({provider:'anthropic',modelId:'claude-sonnet-5',defaultVersion:2})?.provider, 'anthropic');
  assert.deepEqual(supportedModelSettings({...defaultModelSettings, defaultVersion:modelDefaultVersion}), defaultModelSettings);
});

test('Muse receives compatible reasoning options without OpenAI storage or cache controls', () => {
  assert.deepEqual(modelProviderOptions({provider:'meta',modelId:'muse-spark-1.3',reasoningEffort:'medium'},'turn','test'), {meta:{reasoningEffort:'medium'}});
  assert.deepEqual(compactModelMessages([
    {role:'user', content:'Keep the original context'},
    {role:'assistant',content:[{type:'custom',kind:'openai.compaction',providerOptions:{openai:{encryptedContent:'opaque'}}},{type:'text',text:'Previous reply'}]},
  ], 'meta'), [{role:'user',content:'Keep the original context'},{role:'assistant',content:[{type:'text',text:'Previous reply'}]}]);
});
