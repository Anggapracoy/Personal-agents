/** Serial ABBA comparison of automatic and on-demand browser images, Terra Medium. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { createAgentModel } from "../lib/harness/model";
import { runAgent } from "../lib/harness/run";
import { MemoryRunStore } from "../lib/harness/store";
import { closeCloudBrowser, getCloudBrowser } from "../lib/harness/browser/registry";

const databaseUrl = process.env.COMPARISON_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1") throw new Error("An isolated localhost database is required");
process.env.DATABASE_URL = databaseUrl;
delete process.env.INNGEST_EVENT_KEY;
const db = postgres(databaseUrl, { prepare: false, max: 1 });
for (const file of readdirSync("db/migrations").filter(file => file.endsWith(".sql")).sort()) await db.unsafe(readFileSync(`db/migrations/${file}`, "utf8"));
await db.end();
const folder = process.env.COMPARISON_OUTPUT_DIR || "artifacts/browser-vision-comparison";
mkdirSync(folder, { recursive: true });
const prompt = 'Use browser tools to open https://www.selenium.dev/selenium/web/web-form.html. Put "Dash vision comparison" in Text input and "Prepared for comparison. Do not submit." in Textarea. Select "Two" in Dropdown (select). Check Default checkbox. Leave every other control unchanged. Verify the four final values from the page, leave the form unsubmitted, and briefly report the verified values. Do not use api_fetch or sandbox_run, log in, or modify any external account.';
const order = ["automatic", "on-demand", "on-demand", "automatic"] as const;
const pricing = { input: 2, cacheRead: .2, cacheWrite: 2.5, output: 12, unit: "USD per million tokens", source: "https://developers.openai.com/api/docs/pricing", checked: "2026-09-20", scope: "Estimated model API cost only; excludes Browserless/E2B and infrastructure." };
writeFileSync(`${folder}/protocol.json`, JSON.stringify({ prompt, model: "gpt-5.6-terra", reasoning: "medium", order, pricing, scope: "Same updated prompts/tools; only automatic model image policy differs. Serial isolated accounts and browser sessions, two runs per mode, ABBA order. End-to-end time includes model/tool/browser startup, excludes evaluator verification and cleanup. Small sample, not a latency guarantee.", codeHashes: Object.fromEntries(["lib/harness/model.ts", "lib/harness/browser/vision.ts", "lib/harness/tools.ts"].map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])) }, null, 2));
const originalFetch = globalThis.fetch;
type Wire = { model: string; reasoning: unknown; serviceTier: unknown; imageCount: number; requestBytes: number };
let wire: Wire[] = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.openai.com/") && typeof init?.body === "string") {
    const body = JSON.parse(init.body);
    const content = (body.input ?? []).flatMap((message: { content?: unknown[] }) => Array.isArray(message.content) ? message.content : []);
    wire.push({ model: body.model, reasoning: body.reasoning, serviceTier: body.service_tier ?? "default", imageCount: content.filter((part: { type?: string }) => part.type === "input_image").length, requestBytes: Buffer.byteLength(init.body) });
  }
  return originalFetch(url, init);
};
type Usage = { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; responseTimeMs: number | null };
const rows: unknown[] = [];
for (const [index, mode] of order.entries()) {
  const label = `${index + 1}-${mode}`;
  const destination = `${folder}/${label}`;
  mkdirSync(destination, { recursive: true });
  wire = [];
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: `vision-compare-${crypto.randomUUID()}@example.invalid`, decisionId: null, category: "evaluation", title: label, request: prompt, metadata: { sourceType: "manual", modelProvider: "openai", modelId: "gpt-5.6-terra", reasoningEffort: "medium" } });
  const started = performance.now();
  const timer = setInterval(async () => {
    const s = await store.getSnapshot(run.id);
    if (s) { writeFileSync(`${destination}/progress.json`, JSON.stringify({ elapsedMs: performance.now() - started, status: s.status, actions: s.actions }, null, 2)); console.log("PROGRESS", label, Math.round((performance.now() - started) / 1000), s.status, s.actions.length, s.actions.at(-1)?.toolName); }
  }, 15000);
  let thrown: string | null = null;
  try {
    try { await runAgent({ store, runId: run.id, model: createAgentModel(store, { useGlobalSettings: false, automaticBrowserVision: mode === "automatic" }), signal: AbortSignal.timeout(240000) }); }
    catch (error) { thrown = String(error); }
    finally { clearInterval(timer); }
    const elapsedMs = performance.now() - started;
    const snapshot = (await store.getSnapshot(run.id))!;
    const requests = (snapshot.metadata.openaiRequests ?? []) as Usage[];
    const completeUsage = requests.length === wire.length && requests.length > 0 && requests.every(r => typeof r.inputTokens === "number" && typeof r.outputTokens === "number");
    const estimatedModelCostUSD = completeUsage ? requests.reduce((sum, r) => sum + ((r.inputTokens! - (r.cacheReadTokens ?? 0) - (r.cacheWriteTokens ?? 0)) * pricing.input + (r.cacheReadTokens ?? 0) * pricing.cacheRead + (r.cacheWriteTokens ?? 0) * pricing.cacheWrite + r.outputTokens! * pricing.output) / 1e6, 0) : null;
    let finalPage: unknown;
    try { finalPage = await getCloudBrowser(run.userId, run.id).snapshot(); } catch (error) { finalPage = { error: String(error) }; }
    const row = { label, mode, elapsedMs, status: snapshot.status, error: snapshot.error, thrown, response: snapshot.response, result: snapshot.result, estimatedModelCostUSD, completeUsage, requests, wire, actions: snapshot.actions, artifacts: snapshot.artifacts, finalPage };
    for (const a of snapshot.artifacts) { const file = await store.getArtifact(a.id, run.id); if (file) writeFileSync(`${destination}/${a.name.replaceAll("/", "_")}`, Buffer.from(file.bytesBase64, "base64")); }
    writeFileSync(`${destination}/result.json`, JSON.stringify(row, null, 2));
    writeFileSync(`${destination}/messages.json`, JSON.stringify(await store.listMessages(run.id), null, 2));
    rows.push(row);
    writeFileSync(`${folder}/results.json`, JSON.stringify(rows, null, 2));
    console.log("RESULT", JSON.stringify({ label, elapsedMs, status: row.status, error: row.error, thrown, estimatedModelCostUSD, completeUsage, imageInputs: wire.reduce((s, r) => s + r.imageCount, 0), actions: row.actions.map(a => ({ tool: a.toolName, status: a.status })), response: row.response }));
  } finally { await closeCloudBrowser(run.userId); }
}
process.exit(0);
