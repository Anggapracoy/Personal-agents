/** Live, fictional tasks through the production run loop and tools; no durable user data. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createAgentModel } from '../lib/harness/model';
import { runAgent } from '../lib/harness/run';
import { MemoryRunStore } from '../lib/harness/store';

if (!process.env.MUSE_TEST_DATABASE_URL || !['127.0.0.1', 'localhost'].includes(new URL(process.env.MUSE_TEST_DATABASE_URL).hostname)) throw new Error('MUSE_TEST_DATABASE_URL must point to an isolated local test database.');
process.env.DATABASE_URL = process.env.MUSE_TEST_DATABASE_URL;
delete process.env.INNGEST_EVENT_KEY;
const cases = [
  { id: 'invoice-math', request: 'Fictional arithmetic exercise: three invoices are $49, $79, and $125. A $30 credit applies to their combined total. What is the net total? Answer briefly. No tools or account lookup needed.', required: ['223'], fetches: 0 },
  { id: 'public-api-read', request: 'Use api_fetch to read https://jsonplaceholder.typicode.com/todos/1 and tell me its exact title and whether it is completed. Do not use a browser or sandbox.', required: ['delectus aut autem', 'false|not completed|incomplete'], fetches: 1 },
  { id: 'two-source-comparison', request: 'Use api_fetch to read https://jsonplaceholder.typicode.com/todos/1 and https://jsonplaceholder.typicode.com/todos/4. Report each exact title, which todo is completed, and the sum of their IDs. Do not use a browser or sandbox.', required: ['delectus aut autem', 'et porro tempora', '5', '4'], fetches: 2 },
];
const results: unknown[] = [];
mkdirSync('artifacts/muse-smoke', { recursive: true });
for (const probe of cases) {
  for (const provider of ['meta', 'openai'] as const) {
    const modelId = provider === 'meta' ? 'muse-spark-1.3' : 'gpt-5.6-terra';
    const store = new MemoryRunStore();
    const run = await store.createRun({ userId: `muse-smoke-${crypto.randomUUID()}@example.invalid`, decisionId: null, category: 'social', title: probe.id, request: probe.request, metadata: { sourceType: 'manual', modelProvider: provider, modelId, reasoningEffort: 'medium' } });
    const start = performance.now();
    await runAgent({ store, runId: run.id, model: createAgentModel(store, { useGlobalSettings: false }), signal: AbortSignal.timeout(90000) });
    const elapsedMs = performance.now() - start;
    const snapshot = (await store.getSnapshot(run.id))!;
    const messages = await store.listMessages(run.id);
    const text = [snapshot.response, snapshot.result?.summary, snapshot.result?.details].filter(Boolean).join('\n');
    const requests = (snapshot.metadata[provider === 'meta' ? 'metaRequests' : 'openaiRequests'] ?? []) as Array<{inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number}>;
    const usage = requests.reduce((sum, r) => ({ input: sum.input + (r.inputTokens ?? 0), output: sum.output + (r.outputTokens ?? 0), cached: sum.cached + (r.cacheReadTokens ?? 0) }), {input: 0, output: 0, cached: 0});
    // Published USD/M token rates, checked 2026-09-14. Includes Terra cache writes.
    const estimatedCostUSD = requests.length ? requests.reduce((total, r) => {
      const input = r.inputTokens ?? 0, output = r.outputTokens ?? 0, cached = r.cacheReadTokens ?? 0, written = r.cacheWriteTokens ?? 0;
      return total + (provider === 'meta' ? (input-cached)*1.25 + cached*.15 + output*4.25 : (input-cached-written)*2 + cached*.2 + written*2.5 + output*12) / 1e6;
    }, 0) : null;
    const executed = snapshot.actions.filter(a => a.status === 'executed');
    const failures = [snapshot.status !== 'done' ? `status=${snapshot.status}` : '', ...probe.required.filter(pattern => !new RegExp(pattern, 'i').test(text)).map(pattern => `missing ${pattern}`), executed.filter(a => a.toolName === 'api_fetch').length < probe.fetches ? 'missing API fetch evidence' : '', executed.some(a => a.risk === 'write_external') ? 'unexpected external write' : ''].filter(Boolean);
    const row = { task: probe.id, modelId, reasoningEffort: 'medium', elapsedMs, passed: failures.length === 0, failures, status: snapshot.status, error: snapshot.error, text, usage, estimatedCostUSD, requests, actions: snapshot.actions, messages };
    results.push(row);
    writeFileSync('artifacts/muse-smoke/results.json', JSON.stringify({ scope: 'Live production harness with MemoryRunStore; fictional tasks and public read-only APIs; one sample per task/model. Not HTTP/Vercel latency.', results }, null, 2));
    console.log('SMOKE_RESULT', JSON.stringify({ task: row.task, modelId, elapsedMs, passed: row.passed, failures, error: row.error, text, usage, estimatedCostUSD }));
  }
}

process.exit(0);
