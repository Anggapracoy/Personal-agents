/** One isolated live sample; run unchanged in baseline and current source trees. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.COMPARISON_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1") throw new Error("Isolated localhost database required");
process.env.DATABASE_URL = databaseUrl;
delete process.env.INNGEST_EVENT_KEY;
const label = process.env.COMPARISON_LABEL!;
if (!["old-terra", "new-terra", "new-muse"].includes(label)) throw new Error("Unknown comparison configuration");
const folder = process.env.COMPARISON_OUTPUT_DIR!;
if (!folder) throw new Error("Output directory required");
mkdirSync(folder, { recursive: true });
const db = postgres(databaseUrl, { prepare: false, max: 1, onnotice: () => {} });
for (const file of readdirSync("db/migrations").filter(f => f.endsWith(".sql")).sort()) await db.unsafe(readFileSync(`db/migrations/${file}`, "utf8"));
await db.end();
const { createAgentModel } = await import("../lib/harness/model");
const { runAgent } = await import("../lib/harness/run");
const { MemoryRunStore } = await import("../lib/harness/store");
const { closeCloudBrowser, getCloudBrowser } = await import("../lib/harness/browser/registry");
const provider = label === "new-muse" ? "meta" : "openai";
const modelId = provider === "meta" ? "muse-spark-1.3" : "gpt-5.6-terra";
const prompt = 'Use browser tools to open https://www.selenium.dev/selenium/web/web-form.html. Put "Dash vision comparison" in Text input and "Prepared for comparison. Do not submit." in Textarea. Select "Two" in Dropdown (select). Check Default checkbox. Leave every other control unchanged. Verify the four final values from the page, leave the form unsubmitted, and briefly report the verified values. Do not use api_fetch or sandbox_run, log in, or modify any external account.';
const sourceFiles = ["lib/harness/model.ts", "lib/harness/tools.ts", "lib/harness/browser/cloud.ts", "lib/harness/browser/cloud-controller.ts", "lib/harness/browser/vision.ts"];
writeFileSync(`${folder}/protocol.json`, JSON.stringify({ label, modelId, reasoning: "medium", prompt, cwd: process.cwd(), baselineCommit: "a8bd80d584669f4412b5bb41d6d8a05d6712e149", hashes: Object.fromEntries(sourceFiles.map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), timing: "runAgent including model/tool/browser initialization; excludes migration, evaluator and cleanup", sampleSize: 1 }, null, 2));
type Wire = { model: string; reasoning: unknown; serviceTier: unknown; imageCount: number; requestBytes: number; status?: number; headerLatencyMs?: number; error?: string };
const wire: Wire[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  if (/^https:\/\/(api\.openai\.com|api\.meta\.ai)\//.test(address) && typeof init?.body === "string") {
    const body = JSON.parse(init.body);
    const messages = body.input ?? body.messages ?? [];
    const content = messages.flatMap((m: { content?: unknown[] }) => Array.isArray(m.content) ? m.content : []);
    const row: Wire = { model: body.model, reasoning: body.reasoning ?? body.reasoning_effort, serviceTier: body.service_tier ?? "default", imageCount: content.filter((p: { type?: string }) => p.type === "input_image" || p.type === "image_url").length, requestBytes: Buffer.byteLength(init.body) };
    wire.push(row);
    const started = performance.now();
    try { const response = await originalFetch(url, init); row.status = response.status; row.headerLatencyMs = performance.now() - started; return response; }
    catch (error) { row.error = String(error); throw error; }
  }
  return originalFetch(url, init);
};
const store = new MemoryRunStore();
const run = await store.createRun({ userId: `browser-compare-${crypto.randomUUID()}@example.invalid`, decisionId: null, category: "evaluation", title: label, request: prompt, metadata: { sourceType: "manual", modelProvider: provider, modelId, reasoningEffort: "medium" } });
const started = performance.now();
const timer = setInterval(async () => {
  const s = await store.getSnapshot(run.id);
  if (s) { writeFileSync(`${folder}/progress.json`, JSON.stringify({ elapsedMs: performance.now() - started, status: s.status, actions: s.actions }, null, 2)); console.log("PROGRESS", label, Math.round((performance.now() - started) / 1000), s.status, s.actions.length, s.actions.at(-1)?.toolName); }
}, 15000);
let thrown: string | null = null;
try {
  try { await runAgent({ store, runId: run.id, model: createAgentModel(store, { useGlobalSettings: false }), signal: AbortSignal.timeout(240000) }); }
  catch (error) { thrown = String(error); }
  finally { clearInterval(timer); }
  const elapsedMs = performance.now() - started;
  const snapshot = (await store.getSnapshot(run.id))!;
  const requests = (snapshot.metadata[provider === "meta" ? "metaRequests" : "openaiRequests"] ?? []) as Array<{ inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }>;
  let finalPage: unknown;
  try { finalPage = await getCloudBrowser(run.userId, run.id).snapshot(); } catch (error) { finalPage = { error: String(error) }; }
  const completeUsage = requests.length > 0 && requests.length === wire.length && requests.every(r => typeof r.inputTokens === "number" && typeof r.outputTokens === "number");
  const estimatedModelCostUSD = completeUsage ? requests.reduce((sum, r) => sum + (provider === "meta" ? (r.inputTokens! - (r.cacheReadTokens ?? 0)) * 1.25 + (r.cacheReadTokens ?? 0) * .15 + r.outputTokens! * 4.25 : (r.inputTokens! - (r.cacheReadTokens ?? 0) - (r.cacheWriteTokens ?? 0)) * 2 + (r.cacheReadTokens ?? 0) * .2 + (r.cacheWriteTokens ?? 0) * 2.5 + r.outputTokens! * 12) / 1e6, 0) : null;
  const result = { label, modelId, elapsedMs, status: snapshot.status, error: snapshot.error, thrown, response: snapshot.response, result: snapshot.result, metadata: snapshot.metadata, completeUsage, estimatedModelCostUSD, requests, wire, actions: snapshot.actions, artifacts: snapshot.artifacts, finalPage };
  writeFileSync(`${folder}/result.json`, JSON.stringify(result, null, 2));
  writeFileSync(`${folder}/messages.json`, JSON.stringify(await store.listMessages(run.id), null, 2));
  for (const a of snapshot.artifacts) { const file = await store.getArtifact(a.id, run.id); if (file) writeFileSync(`${folder}/${a.name.replaceAll("/", "_")}`, Buffer.from(file.bytesBase64, "base64")); }
  console.log("RESULT", JSON.stringify({ label, elapsedMs, status: snapshot.status, error: snapshot.error, thrown, completeUsage, estimatedModelCostUSD, wire, actions: snapshot.actions.map(a => ({ tool: a.toolName, status: a.status })), response: snapshot.response }));
} finally {
  clearInterval(timer);
  try { await closeCloudBrowser(run.userId); writeFileSync(`${folder}/cleanup.json`, JSON.stringify({ browserClosed: true })); }
  catch (error) { writeFileSync(`${folder}/cleanup.json`, JSON.stringify({ browserClosed: false, error: String(error) })); }
}
process.exit(0);
