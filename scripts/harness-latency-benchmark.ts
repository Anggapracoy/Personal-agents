/** Real HTTP -> auth -> PostgreSQL -> Inngest -> model -> SSE benchmark. No mocked model or dispatch. */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { encode } from "next-auth/jwt";
import { PostgresRunStore } from "../lib/harness/store";
import type { AgentRun, AgentRunSnapshot } from "../lib/harness/types";
import type { ModelMessage } from "ai";

const { values } = parseArgs({ options: { url: { type: "string" }, fixture: { type: "string" }, output: { type: "string" }, count: { type: "string", default: "3" } } });
if (!values.url || !values.fixture || !values.output || !process.env.DATABASE_URL || !process.env.AUTH_SECRET) throw new Error("Supply --url, --fixture, --output, DATABASE_URL and AUTH_SECRET.");
const base = new URL(values.url);
const database = new URL(process.env.DATABASE_URL);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!localHosts.has(base.hostname) || !localHosts.has(database.hostname) || process.env.INNGEST_DEV !== "1") throw new Error("This benchmark requires an isolated local app, database, and Inngest Dev Server.");
const count = Number(values.count);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("--count must be 1..20.");
const fixture = JSON.parse(await readFile(values.fixture, "utf8")) as Pick<AgentRun, "request" | "title" | "category" | "metadata" | "result"> & { messages: ModelMessage[]; followUp?: string };
const owner = "latency-benchmark@example.test";
const token = await encode({ token: { email: owner, name: "Latency benchmark", sub: owner }, secret: process.env.AUTH_SECRET, salt: "decision-feed.session-token", maxAge: 3600 });
const headers = { cookie: `decision-feed.session-token=${token}`, "content-type": "application/json" };
const store = new PostgresRunStore(process.env.DATABASE_URL);
const samples: Record<string, unknown>[] = [];
const round = (value: number) => Math.round(value * 1000) / 1000;

for (let sample = 1; sample <= count; sample++) {
  const run = await store.createRun({ userId: owner, decisionId: null, category: fixture.category, request: fixture.request, title: fixture.title, metadata: { ...fixture.metadata, modelProvider: "openai", modelId: "gpt-5.6-terra", reasoningEffort: "medium" } });
  await store.appendMessages(run.id, fixture.messages);
  await store.updateRun(run.id, { status: "done", result: fixture.result });
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const response = await fetch(new URL(`/api/runs/${run.id}/message`, base), { method: "POST", headers, body: JSON.stringify({ text: fixture.followUp ?? "What happens if I decline it? Keep it brief." }), signal: AbortSignal.timeout(180_000) });
  const acceptedMs = performance.now() - started;
  if (!response.ok) throw new Error(`Message failed (${response.status}): ${await response.text()}`);
  let final = await response.json() as AgentRunSnapshot;
  let firstTextMs: number | null = final.response ? performance.now() - started : null;
  const events: Array<{ atMs: number; status: string; chars: number }> = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const stream = await fetch(new URL(`/api/runs/${run.id}/events`, base), { headers, signal: controller.signal });
    if (!stream.ok || !stream.body) throw new Error(`Event stream failed (${stream.status}).`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const blocks = pending.split("\n\n"); pending = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block.split("\n").find(line => line.startsWith("data: "));
        if (!data || !block.includes("event: snapshot")) continue;
        final = JSON.parse(data.slice(6));
        const atMs = performance.now() - started;
        events.push({ atMs: round(atMs), status: final.status, chars: final.response.length });
        if (final.response && firstTextMs === null) firstTextMs = atMs;
        if (["done", "failed", "cancelled", "awaiting_approval", "paused"].includes(final.status)) { done = true; break; }
      }
    }
    await reader.cancel();
  } finally { clearTimeout(timeout); controller.abort(); }
  const totalMs = performance.now() - started;
  const messages = await store.listMessages(run.id);
  const newMessages = messages.slice(fixture.messages.length);
  const toolCalls = newMessages.flatMap(({ message }) => message.role === "assistant" && Array.isArray(message.content) ? message.content.filter(part => part.type === "tool-call").map(part => part.toolName) : []);
  const requests = final.metadata.openaiRequests;
  const result = { sample, runId: run.id, startedAt, acceptedMs: round(acceptedMs), firstTextMs: firstTextMs === null ? null : round(firstTextMs), totalMs: round(totalMs), completedAt: final.completedAt, status: final.status, response: final.response, result: final.result, toolCalls, requests, events };
  samples.push(result);
  await writeFile(values.output, JSON.stringify({ scope: "Local production Next.js build, authenticated message endpoint, PostgreSQL, real Inngest scheduler/worker, Terra medium, production harness and SSE. No phone, Vercel cloud startup, or browser paint measurement. No connected personal accounts.", samples }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ sample, runId: run.id, acceptedMs: result.acceptedMs, firstTextMs: result.firstTextMs, totalMs: result.totalMs, status: final.status, toolCalls }));
  if (final.status !== "done") throw new Error(`Benchmark did not complete: ${final.status}`);
  if (toolCalls.some(name => !["present_result", "show_options"].includes(name))) throw new Error("Unexpected tool use; inspect the isolated run before continuing.");
}
process.exit(0);
