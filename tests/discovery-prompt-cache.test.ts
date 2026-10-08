import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryInstructions, discoveryCacheOptions } from '../lib/discovery/prompt-cache';

test('Luna discovery keeps the reusable boundary unchanged when user/time context changes', () => {
  const model = {provider:'openai', modelId:'gpt-6-luna'};
  const first = discoveryInstructions(model, 'Stable rules', 'Monday: user A');
  const second = discoveryInstructions(model, 'Stable rules', 'Tuesday: user B');
  assert.ok(Array.isArray(first) && Array.isArray(second));
  assert.deepEqual(first[0], second[0]);
  assert.deepEqual(first.map(m=>m.content), ['Stable rules','Monday: user A']);
  assert.equal(first[1].role,'system');
  assert.equal(first[1].providerOptions,undefined);
  assert.deepEqual(first[0].providerOptions,{openai:{promptCacheBreakpoint:{mode:'explicit'}}});
});
test('single-pass reviews cache the stable prefix; tool research also caches history', () => {
  const model={provider:'openai',modelId:'gpt-6-luna'};
  for(const stage of ['qualification','false_negative_review','verdict']) assert.deepEqual(discoveryCacheOptions(model,stage),{promptCacheOptions:{mode:'explicit',ttl:'30m'}});
  assert.deepEqual(discoveryCacheOptions(model,'research'),{promptCacheOptions:{mode:'implicit',ttl:'30m'}});
});
test('unsupported models retain original instruction text and no OpenAI cache options', () => {
  for(const model of [{provider:'google',modelId:'gemini-3.7-flash'},{provider:'openai',modelId:'gpt-5.4'},{provider:'cerebras',modelId:'other'}]) {
    assert.equal(discoveryInstructions(model,'Rules','Context'),'Rules\nContext');
    assert.deepEqual(discoveryCacheOptions(model,'qualification'),{});
  }
});

test('SDK sends the explicit boundary on stable developer text, before dynamic context', async () => {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const { generateText } = await import('ai');
  let body: any;
  const api = createOpenAI({apiKey:'test-only', fetch: async (_url, init) => {
    body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({error:{message:'Fixture stops before execution',type:'invalid_request_error'}}),{status:400,headers:{'content-type':'application/json'}});
  }});
  const selected={provider:'openai',modelId:'gpt-6-luna'};
  await assert.rejects(generateText({model:api(selected.modelId),system:discoveryInstructions(selected,'Stable instructions','Changing context'),prompt:'Email batch',providerOptions:{openai:discoveryCacheOptions(selected,'qualification')},maxRetries:0}));
  assert.deepEqual(body.prompt_cache_options,{mode:'explicit',ttl:'30m'});
  assert.equal(body.input[0].role,'developer');
  assert.deepEqual(body.input[0].content[0],{type:'input_text',text:'Stable instructions',prompt_cache_breakpoint:{mode:'explicit'}});
  assert.deepEqual(body.input[1],{role:'developer',content:'Changing context'});
});
