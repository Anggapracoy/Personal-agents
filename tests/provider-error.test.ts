import assert from 'node:assert/strict';
import test from 'node:test';
import { providerBillingFailure, providerErrorMessage, providerFailureMiddleware } from '../lib/harness/provider-error';
import { rateLimitDelay } from '../lib/harness/rate-limit';
test('nested billing failures keep bounded diagnostics without the provider payload', () => {
  const error = {cause:{statusCode:402,responseBody:'{"error":{"code":"billing_not_configured"},"secret":"private"}',responseHeaders:{'x-request-id':'provider-123',authorization:'private'}}};
  assert.deepEqual(providerBillingFailure(error),{status:402,code:'billing_not_configured',requestId:'provider-123'});
  assert.equal(rateLimitDelay(error),null);
  assert.equal(providerBillingFailure(new Error('Billing verification failed. Please check your payment method.'))?.status,402);
  assert.equal(providerBillingFailure({statusCode:429,message:'rate_limit_error'}),null);
});

test('plain stream errors keep their useful message without serializing provider payloads', () => {
  assert.equal(providerErrorMessage({ type: 'response.failed', response: { error: { code: 'invalid_request_error', message: 'The response input is invalid.' }, output: 'private' } }), 'The response input is invalid.');
  assert.equal(providerErrorMessage(new Error('Existing error')), 'Existing error');
  const cycle: Record<string, unknown> = { requestBody: 'private' }; cycle.cause = cycle;
  assert.equal(providerErrorMessage(cycle), 'Agent turn failed');
});

test('failure diagnostics preserve longer streamed Retry-After and exclude response contents', async () => {
  const { streamText, wrapLanguageModel } = await import('ai');
  const { storedOpenAIModel } = await import('../lib/harness/stored-openai');
  const events = [
    { type: 'response.created', response: { id: 'resp_later', model: 'gpt-6-sol', created_at: 1 } },
    { type: 'response.in_progress', response: { id: 'resp_later' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'compaction', id: 'cmp_later', encrypted_content: '' } },
    { type: 'response.failed', sequence_number: 4, response: { id: 'resp_later', error: { code: 'rate_limit_exceeded', message: 'Wait', headers: { 'retry-after': '95', authorization: 'private' } }, output: 'private', usage: null } },
  ];
  const failures: unknown[] = [];
  const model = wrapLanguageModel({ model: storedOpenAIModel('gpt-6-sol', { apiKey: 'test', fetch: async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_later' } }) }), middleware: providerFailureMiddleware(async failure => { failures.push(failure); }) });
  const result = streamText({ model, prompt: 'Replay', maxRetries: 0, includeRawChunks: true, onError: () => {} });
  let delay: number | null = null;
  for await (const part of result.fullStream) if (part.type === 'error') delay = rateLimitDelay(part.error);
  assert.equal(delay, 95_000);
  assert.deepEqual(failures, [{ code: 'rate_limit_exceeded', type: 'response.failed', status: null, requestId: 'req_later', responseId: 'resp_later' }]);
  assert.ok(!JSON.stringify(failures).includes('private'));
});

test('a billing interruption tries the fallback once and terminates if both providers fail', async()=>{
  const { MemoryRunStore } = await import('../lib/harness/store');
  const { runAgent } = await import('../lib/harness/run');
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'billing-test',decisionId:null,category:'test',title:'Checkout',request:'Buy five packs',metadata:{}});
  await store.appendMessages(run.id,[{role:'user',content:'Five packs, please.'}]);
  let calls=0;
  await runAgent({runId:run.id,store,model:{async turn(){calls++;throw Object.assign(new Error('Provider request failed'),{statusCode:402,responseBody:'{"code":"billing_not_configured"}'});}}});
  const saved=await store.getRun(run.id);
  assert.equal(calls,2); assert.equal(saved?.status,'failed');
  assert.match(saved?.error ?? '',/billing_not_configured/);
  assert.equal(saved?.metadata.modelRetryAt,null);
  assert.equal((await store.listMessages(run.id))[0].message.content,'Five packs, please.');
});


test('billing failure silently resumes saved history on Terra medium', async () => {
  const { MemoryRunStore } = await import('../lib/harness/store');
  const { runAgent } = await import('../lib/harness/run');
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'fallback-test',decisionId:null,category:'test',title:'Dinner',request:'Find dinner',metadata:{modelProvider:'meta'}});
  await store.appendMessages(run.id,[{role:'user',content:'Dinner for two.'}]);
  let calls = 0;
  await runAgent({runId:run.id,store,model:{async turn({run: current,onNarration}) {
    calls++;
    if (calls === 1) throw Object.assign(new Error('Billing verification failed. Please check your payment method.'),{statusCode:402});
    assert.equal(current.status,'running');
    assert.equal(current.error,null);
    assert.equal(current.metadata.modelProvider,'openai');
    assert.equal(current.metadata.modelId,'gpt-5.6-terra');
    assert.equal(current.metadata.reasoningEffort,'medium');
    assert.equal((await store.listMessages(run.id))[0].message.content,'Dinner for two.');
    await onNarration('Here are your dinner options.');
  }}});
  const saved = await store.getRun(run.id);
  assert.equal(calls,2);
  assert.equal(saved?.status,'done');
  assert.equal(saved?.error,null);
  assert.equal(saved?.response,'Here are your dinner options.');
  assert.equal(saved?.metadata.providerFallback,'terra-medium');
});
