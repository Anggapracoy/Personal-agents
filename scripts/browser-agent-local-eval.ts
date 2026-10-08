/** Whole agent-task evaluation: real model, production tools/controller/store, local Chrome and PostgreSQL. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
const url = process.env.COMPARISON_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1') throw new Error('Isolated local database required');
process.env.DATABASE_URL = url;
// Never provision paid browsers/sandboxes or dispatch external workflows in this evaluation.
for (const key of ['BROWSERLESS_API_TOKEN', 'E2B_API_KEY', 'INNGEST_EVENT_KEY']) delete process.env[key];
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`create table if not exists benchmark_migrations (name text primary key)`;
for (const file of readdirSync('db/migrations').filter(f => f.endsWith('.sql')).sort()) {
  if ((await sql`select name from benchmark_migrations where name=${file}`).length) continue;
  await sql.unsafe(readFileSync(`db/migrations/${file}`, 'utf8'));
  await sql`insert into benchmark_migrations values (${file})`;
}
const { modelCassette } = await import('./benchmarks/model-cassette');
const cassette = modelCassette();
const { localBrowser } = await import('./benchmarks/local-browser');
const { PostgresRunStore } = await import('../lib/harness/store');
const { createAgentModel } = await import('../lib/harness/model');
const { runAgent } = await import('../lib/harness/run');
const root = process.env.BROWSER_LATENCY_OUTPUT || '/tmp/dash-whole-agent-eval';
mkdirSync(root, { recursive: true });
const store = new PostgresRunStore(url);
if (process.env.BROWSER_SNAPSHOT_BASELINE === '1') {
  // Former snapshot implementation for A/B only: same result, eagerly reads all binary content.
  store.getSnapshot = async id => {
    const run = await store.getRun(id); if (!run) return null;
    const [actions, artifacts] = await Promise.all([store.sql`select * from agent_actions where run_id=${id} order by created_at`, store.sql`select id,run_id,action_id,name,mime_type,content,created_at from agent_artifacts where run_id=${id} order by created_at`]);
    const internals = store as unknown as { action: (r: Record<string, unknown>) => import('../lib/harness/types').AgentAction; artifact: (r: Record<string, unknown>) => import('../lib/harness/types').AgentArtifact };
    const latest = new Map<string, Omit<import('../lib/harness/types').AgentArtifact, 'bytesBase64'>>();
    for (const row of artifacts) { const {bytesBase64: _, ...a} = internals.artifact(row); latest.delete(a.name.toLowerCase()); latest.set(a.name.toLowerCase(), a); }
    return { ...run, actions: actions.map(row => internals.action(row)), artifacts: [...latest.values()] };
  };
}
const run = await store.createRun({ userId: `local-form-${crypto.randomUUID()}@example.invalid`, decisionId: null, category: 'evaluation', title: 'Local full task form benchmark', metadata: { modelProvider: 'openai', modelId: 'gpt-6-sol', reasoningEffort: 'medium', userTimeZone: 'America/Toronto' }, request: 'Use the cloud browser to open https://form-benchmark.example/web-form.html. Set Text input to the exact literal string "Dash form test". Set Textarea to the exact literal string "Testing without submitting". Choose Two in Dropdown (select). Check Default checkbox. Inspect the form again to verify all four values and capture a screenshot named prepared-form.png. Do not fill the password, change any other fields, or click Submit. Briefly report whether all four values were verified and confirm the form was not submitted.' });
if (process.env.BROWSER_ARTIFACT_HISTORY === '1') {
  // Representative 50 MiB saved-frame history (the measured existing form chat has 53 MB).
  // Synthetic bytes never appear in model inputs; only identical metadata does.
  const { randomBytes } = await import('node:crypto');
  const content = randomBytes(500 * 1024);
  for (let i = 0; i < 100; i++) await store.createArtifact({ runId: run.id, actionId: null, name: `browser-frame-history-${i}.png`, mimeType: 'image/png', bytesBase64: content.toString('base64') });
}
const snapshotTimes: number[] = [];
const getSnapshot = store.getSnapshot.bind(store);
store.getSnapshot = async id => { const start = performance.now(); try { return await getSnapshot(id); } finally { snapshotTimes.push(performance.now() - start); } };
const browser = await localBrowser(run.userId, run.id);
const start = performance.now();
const timer = setInterval(() => console.log('PROGRESS', run.id, Math.round((performance.now() - start) / 1000)), 15000);
try {
  await runAgent({ store, runId: run.id, model: createAgentModel(store, { useGlobalSettings: false }), signal: AbortSignal.timeout(240000), sliceMs: 240000 });
  const elapsedMs = performance.now() - start;
  const snapshot = (await store.getSnapshot(run.id))!;
  const checks = { done: snapshot.status === 'done', actionsSucceeded: snapshot.actions.every(a => a.status === 'executed'), text: await browser.page.getByLabel('Text input', { exact: true }).inputValue() === 'Dash form test', textarea: await browser.page.getByLabel('Textarea', { exact: true }).inputValue() === 'Testing without submitting', dropdown: await browser.page.locator('select').inputValue() === '2', checkbox: await browser.page.getByLabel('Default checkbox', { exact: true }).isChecked(), passwordUntouched: await browser.page.getByLabel('Password', { exact: true }).inputValue() === '', unsubmitted: await browser.page.evaluate(() => document.body.dataset.submitted !== 'true'), screenshot: snapshot.artifacts.some(a => a.name === 'prepared-form.png') };
  const result = { scope: process.env.BROWSER_MODEL_REPLAY === '1' ? 'Full runAgent replay with recorded Sol choices, production tools/controller and local Chrome/PostgreSQL; fixed recorded model waits when timingReplay is true. Excludes scheduler/provider startup.' : 'Full runAgent through final response; real Sol medium, production tool policies and local controller/Chrome/PostgreSQL. Excludes scheduler/network/provider startup.', runId: run.id, replay: process.env.BROWSER_MODEL_REPLAY === '1', timingReplay: Boolean(process.env.BROWSER_MODEL_REPLAY_TIMINGS), artifactHistory: process.env.BROWSER_ARTIFACT_HISTORY === '1', snapshotTimes, elapsedMs, checks, passed: Object.values(checks).every(Boolean), status: snapshot.status, response: snapshot.response, requests: snapshot.metadata.openaiRequests, actions: snapshot.actions, browserTimings: browser.timings };
  writeFileSync(`${root}/${run.id}.json`, JSON.stringify(result, null, 2));
  writeFileSync(`${root}/${run.id}-messages.json`, JSON.stringify(await store.listMessages(run.id), null, 2));
  console.log('RESULT', JSON.stringify({ runId: run.id, elapsedMs, checks, status: snapshot.status, actions: snapshot.actions.map(a => ({ tool: a.toolName, status: a.status })), error: snapshot.error }));
  if (!result.passed) throw new Error('Full-task verification failed; see saved results');
} finally { clearInterval(timer); await browser.close(); await store.sql.end(); await sql.end(); await cassette.finish(); }
process.exit(0);
