/** Local full-harness replay: live Muse, synthetic Calendar, no production DB or external actions. */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createAgentModel } from "../lib/harness/model";
import { runAgent } from "../lib/harness/run";
import { MemoryRunStore } from "../lib/harness/store";
import type { ModelMessage } from "ai";

if (!process.env.INTENT_TEST_DATABASE_URL || new URL(process.env.INTENT_TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Use an isolated local INTENT_TEST_DATABASE_URL");
process.env.DATABASE_URL = process.env.INTENT_TEST_DATABASE_URL;
delete process.env.INNGEST_EVENT_KEY;
const phase = process.argv[2] ?? "patched";
const sampleCount = Number(process.env.INTENT_SAMPLES ?? 3);
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20) throw new Error("INTENT_SAMPLES must be 1–20");
const scenario = process.env.INTENT_SCENARIO ?? "original";
if (!["original", "paraphrase", "topic-switch"].includes(scenario)) throw new Error("Unknown INTENT_SCENARIO");
const expectedTools = scenario === "topic-switch" ? ["gmail_search_messages"] : ["calendar_search_events", "calendar_get_event"];
const allowedTools = [...expectedTools, "check_current_time"];
const event = { id: "zoom-example", summary: "Zoom with Alex", start: { dateTime: "2026-09-14T18:00:00-04:00", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-09-14T18:30:00-04:00", timeZone: "America/Los_Angeles" } };
const modelSource = readFileSync(new URL("../lib/harness/model.ts", import.meta.url), "utf8");
const intentLine = JSON.parse(modelSource.match(/const workflowSelectionRule = \[\s*("(?:[^"\\]|\\.)*")/)?.[1] ?? '""') as string;
if (!intentLine) throw new Error("Could not find intent guidance for baseline comparison");
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.meta.ai") {
    if (phase.startsWith("baseline") && typeof init?.body === "string") return realFetch(input, { ...init, body: init.body.replace(intentLine, "") });
    return realFetch(input, init);
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/calendar/") && (!init?.method || init.method === "GET")) return Response.json(url.pathname.endsWith("/events") ? { timeZone: "America/Toronto", items: [event] } : event);
  if (scenario === "topic-switch" && url.hostname === "gmail.googleapis.com" && url.pathname.endsWith("/messages") && (!init?.method || init.method === "GET")) return Response.json({ messages: [], resultSizeEstimate: 0 });
  throw new Error(`Replay blocked external access to ${url.hostname}`);
};
const history: ModelMessage[] = [
  { role: "user", content: "Wait what time was my zoom from today" },
  { role: "assistant", content: "6 to 630pm" },
  { role: "user", content: "U said 9" },
  { role: "assistant", content: "u got me, that was on me\nit was 6 to 630pm toronto time. invite had LA on it so i read it as 9 at first" },
  { role: "user", content: "Where did it say LA" },
  { role: "assistant", content: "in the calendar invite, the timezone field was america/los_angeles" },
  { role: "user", content: "Imma deploy a fix then u need to tell me if it shows its fixed ok" },
  { role: "assistant", content: "yeah bet, just lmk when its deployed and what u fixed and ill check it" },
];
const results = [];
for (let sample = 1; sample <= sampleCount; sample++) {
  const store = new MemoryRunStore();
  const request = scenario === "topic-switch" ? "Actually forget the time thing. Check my newest unread emails instead." : scenario === "paraphrase" ? "ok the change is live now, try it again" : "Deployed. Check it pls";
  const run = await store.createRun({ userId: `intent-${crypto.randomUUID()}@example.invalid`, decisionId: null, category: "social", title: "General Greeting", request, metadata: { sourceType: "manual", userTimeZone: "America/Toronto", modelProvider: "meta", modelId: "muse-spark-1.3", reasoningEffort: "medium" } });
  await store.putSecret(run.id, "google_access_token", "synthetic-only");
  const savedHistory = process.env.INTENT_REPLAY_HISTORY ? JSON.parse(readFileSync(process.env.INTENT_REPLAY_HISTORY, "utf8")) as ModelMessage[] : [...history, { role: "user" as const, content: request }];
  savedHistory[savedHistory.length - 1] = { role: "user", content: request };
  await store.appendMessages(run.id, savedHistory);
  const controller = new AbortController();
  const attempted: string[] = [];
  const attemptedInputs: Array<{ tool: string; input: unknown }> = [];
  const createAction = store.createAction.bind(store);
  store.createAction = async input => {
    attempted.push(input.toolName);
    attemptedInputs.push({ tool: input.toolName, input: input.input });
    if (!allowedTools.includes(input.toolName)) {
      controller.abort();
      throw new Error(`Replay stopped before unrelated tool ${input.toolName}`);
    }
    return createAction(input);
  };
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    await runAgent({ store, runId: run.id, model: createAgentModel(store, { useGlobalSettings: false, onRawToolInput: name => {
      attempted.push(name);
      if (!allowedTools.includes(name)) controller.abort();
    } }), signal: controller.signal });
  } finally { clearTimeout(timer); }
  const snapshot = (await store.getSnapshot(run.id))!;
  const passed = snapshot.status === "done" && snapshot.actions.every(a => allowedTools.includes(a.toolName)) && snapshot.actions.some(a => expectedTools.includes(a.toolName) && a.status === "executed") && attempted.every(name => allowedTools.includes(name));
  const result = { sample, passed, attempted, attemptedInputs, status: snapshot.status, response: snapshot.response, result: snapshot.result, error: snapshot.error, actions: snapshot.actions.map(a=>({tool:a.toolName,status:a.status})) };
  results.push(result); console.log(JSON.stringify(result));
}
mkdirSync('artifacts/intent-followup',{recursive:true});
writeFileSync(`artifacts/intent-followup/${phase}.json`, JSON.stringify({scope:process.env.INTENT_REPLAY_HISTORY ? 'Saved pre-failure conversation, full local harness with live Muse medium; synthetic source responses and blocked unrelated external tools' : 'Screenshot follow-up excerpt, full local harness with live Muse medium; synthetic source responses and blocked unrelated external tools',scenario,sampleCount,intentGuidance:phase.startsWith("baseline") ? null : intentLine,results},null,2));
process.exitCode = results.every(r=>r.passed) ? 0 : 1;

process.exit(process.exitCode ?? 0);
