import assert from "node:assert/strict";
import test from "node:test";
import { fastInvokeAgent, dispatchInteractiveAgent } from "../lib/harness/fast-invoke";
import { AGENT_APP_ID, AGENT_FUNCTION_ID } from "../lib/harness/inngest-config";
import { MemoryRunStore } from "../lib/harness/store";
import { runAgent } from "../lib/harness/run";
import { appendConversationReply } from "../lib/harness/conversation-reply";
import { recoverRun, STALE_WORKER_MS } from "../lib/harness/recovery";
import { dispatchInteractiveRun, dispatchRun } from "../lib/harness/dispatch";
import { inngest } from "../lib/harness/inngest-client";

const options = { enabled: true, signingKey: "test-signing-key" };
const receipt = () => Response.json({ data: { runId: "invocation-id" } });

for (const status of [200, 201, 202, 409]) {
  test(`fast invoke accepts the live/documented ${status} admission response`, async () => {
    let sent = 0;
    const result = await fastInvokeAgent("chat-id", "stable-key", { ...options, fetcher: async (url, init) => {
      sent++;
      assert.equal(url, `https://api.inngest.com/v2/apps/${AGENT_APP_ID}/functions/${AGENT_FUNCTION_ID}/invoke`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-signing-key");
      assert.deepEqual(JSON.parse(String(init?.body)), { data: { runId: "chat-id" }, idempotencyKey: "stable-key" });
      assert.ok(init?.signal);
      return Response.json({ data: { runId: status === 409 ? "00000000000000000000000000" : "invocation-id" } }, { status });
    } });
    assert.equal(result, "accepted");
    assert.equal(sent, 1);
  });
}

test("lost response retries the same request and accepts duplicate admission", async () => {
  const bodies: string[] = [];
  const result = await fastInvokeAgent("chat-id", undefined, { ...options, fetcher: async (_url, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) throw new DOMException("timed out", "TimeoutError");
    return new Response(null, { status: 409 });
  } });
  assert.equal(result, "accepted");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.ok(JSON.parse(bodies[0]).idempotencyKey);
});

test("distinct dispatches receive distinct idempotency keys", async () => {
  const keys: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => { keys.push(JSON.parse(String(init?.body)).idempotencyKey); return receipt(); };
  await fastInvokeAgent("chat-id", undefined, { ...options, fetcher });
  await fastInvokeAgent("chat-id", undefined, { ...options, fetcher });
  assert.notEqual(keys[0], keys[1]);
});

for (const status of [401, 403, 404, 429]) {
  test(`definite ${status} rejection falls back to exactly one event`, async () => {
    let invokes = 0, events = 0;
    const admitted = await dispatchInteractiveAgent("chat-id", "key", { ...options,
      fetcher: async () => { invokes++; return new Response(null, { status }); },
      sendEvent: async () => { events++; }, onUncertain: () => assert.fail("not uncertain"),
    });
    assert.equal(invokes, 1); assert.equal(events, 1);
    assert.equal(admitted, true);
  });
}

test("disabled or unconfigured fast invoke preserves event dispatch", async () => {
  for (const override of [{ enabled: false }, { signingKey: undefined }]) {
    let events = 0;
    await dispatchInteractiveAgent("chat-id", undefined, { ...options, ...override,
      fetcher: async () => assert.fail("must not invoke"), sendEvent: async () => { events++; },
      onUncertain: () => assert.fail("not uncertain"),
    });
    assert.equal(events, 1);
  }
});

for (const lastStatus of [401, 403, 404, 429, 500, 422]) {
  test(`timeout followed by ${lastStatus} never creates a fallback event`, async () => {
    let calls = 0, uncertain = 0;
    const admitted = await dispatchInteractiveAgent("chat-id", undefined, { ...options,
      fetcher: async () => { if (++calls === 1) throw new Error("connection lost"); return new Response(null, { status: lastStatus }); },
      sendEvent: async () => assert.fail("could duplicate an admitted invocation"), onUncertain: () => { uncertain++; },
    });
    assert.equal(calls, 2); assert.equal(uncertain, 1);
    assert.equal(admitted, false, "uncertain admission cannot authorize a local start");
  });
}

test("malformed success retries the same key without claiming success or falling back", async () => {
  const keys: string[] = [];
  const result = await fastInvokeAgent("chat-id", "key", { ...options, fetcher: async (_url, init) => {
    keys.push(JSON.parse(String(init?.body)).idempotencyKey);
    return new Response("not json", { status: 200 });
  } });
  assert.equal(result, "uncertain"); assert.deepEqual(keys, ["key", "key"]);
});

test("definite invalid input is reported without leaking credentials or response bodies", async () => {
  await assert.rejects(fastInvokeAgent("chat-id", undefined, { ...options,
    fetcher: async () => new Response("private upstream details", { status: 400 }),
  }), { message: "Agent invocation rejected (400)." });
});

test("uncertain admission keeps a chat active and eligible for durable recovery", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "test", request: "hello", title: "hello", metadata: {} });
  await dispatchInteractiveAgent(run.id, undefined, { ...options,
    fetcher: async () => { throw new Error("timeout"); }, sendEvent: async () => assert.fail("no duplicate event"), onUncertain: () => {},
  });
  let recovered = 0;
  assert.equal(await recoverRun(store, run.id, async () => { recovered++; }, Date.now() + STALE_WORKER_MS + 1000), true);
  assert.equal(recovered, 1);
  assert.equal((await store.getRun(run.id))?.status, "planning");
});

test("an accepted invocation with a lost receipt cannot overwrite a completed chat", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "test", request: "hello", title: "hello", metadata: {} });
  let turns = 0;
  await dispatchInteractiveAgent(run.id, "same-key", { ...options, fetcher: async () => {
    await runAgent({ runId: run.id, store, model: { async turn({ onNarration }) { turns++; await onNarration("Hello"); } } });
    throw new Error("receipt lost after acceptance");
  }, sendEvent: async () => assert.fail("no second event"), onUncertain: () => {} });
  assert.equal(turns, 1);
  assert.equal((await store.getRun(run.id))?.status, "done");
});

test("invocation respects cancellation and approval pauses; approved continuation can run", async () => {
  for (const status of ["cancelled", "awaiting_approval"] as const) {
    const store = new MemoryRunStore();
    const run = await store.createRun({ userId: "test", decisionId: null, category: "test", request: "hello", title: "hello", metadata: {} });
    await store.updateRun(run.id, { status });
    let turns = 0;
    const fetcher: typeof fetch = async () => {
      await runAgent({ runId: run.id, store, model: { async turn({ onNarration }) { turns++; await onNarration("Done"); } } });
      return receipt();
    };
    await fastInvokeAgent(run.id, "before", { ...options, fetcher });
    assert.equal(turns, 0);
    assert.equal((await store.getRun(run.id))?.status, status);
    if (status === "awaiting_approval") {
      await store.appendMessages(run.id, [{ role: "user", content: "[runtime] Approved" }]);
      await store.updateRun(run.id, { status: "running" });
      await fastInvokeAgent(run.id, "after", { ...options, fetcher });
      assert.equal(turns, 1);
      assert.equal((await store.getRun(run.id))?.status, "done");
    }
  }
});

test("proactive execution and an invoked reply share one worker and preserve steering", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: "proactive-test", category: "test", request: "Check a plan", title: "Plan", metadata: {} });
  await store.appendMessages(run.id, [{ role: "user", content: "Check a plan" }]);
  let turns = 0;
  await runAgent({ runId: run.id, store, model: { async turn({ onNarration }) {
    if (++turns === 1) {
      assert.equal(await appendConversationReply(store, run.id, "Make it tomorrow"), "steering");
      await dispatchInteractiveAgent(run.id, "reply-key", { ...options, fetcher: async () => {
        const duplicate = await runAgent({ runId: run.id, store, model: { async turn() { assert.fail("concurrent model turn"); } } });
        assert.deepEqual(duplicate, { retryAfterMs: 5000 });
        return receipt();
      }, sendEvent: async () => assert.fail("no event fallback"), onUncertain: () => assert.fail("admitted") });
    } else {
      assert.ok((await store.listMessages(run.id)).some(m => m.message.content === "Make it tomorrow"));
    }
    await onNarration("Done");
  } } });
  assert.equal(turns, 2);
  assert.equal((await store.getRun(run.id))?.status, "done");
});

test("interactive dispatch uses cloud invoke while background and custom environments retain events", async t => {
  const names = ["DATABASE_URL", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "INNGEST_DEV", "INNGEST_ENV", "INNGEST_BASE_URL", "INNGEST_API_BASE_URL", "INNGEST_FAST_INVOKE", "VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "BRANCH_NAME"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const syncEnv = () => inngest.setEnvVars(Object.fromEntries(names.map(name => [name, process.env[name]])));
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } syncEnv(); });
  for (const name of names) delete process.env[name];
  Object.assign(process.env, { DATABASE_URL: "unused", INNGEST_EVENT_KEY: "test-event", INNGEST_SIGNING_KEY: "test-signing", INNGEST_DEV: "0" });
  syncEnv();
  let invokes = 0;
  const events: unknown[] = [];
  t.mock.method(globalThis, "fetch", async () => { invokes++; return receipt(); });
  t.mock.method(inngest, "send", async (event: unknown) => { events.push(event); return { ids: ["test"] }; });
  await dispatchInteractiveRun("chat", "reply");
  assert.equal(invokes, 1); assert.equal(events.length, 0);
  await dispatchRun("chat", "recovery");
  assert.deepEqual(events.pop(), { id: "recovery", name: "decision-feed/run.requested", data: { runId: "chat" } });
  for (const [name, value] of [["INNGEST_DEV", "1"], ["INNGEST_ENV", "preview"], ["INNGEST_BASE_URL", "http://localhost:8288"], ["INNGEST_FAST_INVOKE", "0"]]) {
    const before = process.env[name];
    process.env[name] = value;
    syncEnv();
    await dispatchInteractiveRun("chat", "reply");
    assert.equal(invokes, 1);
    assert.deepEqual(events.pop(), { id: "reply", name: "decision-feed/run.requested", data: { runId: "chat" } });
    if (before === undefined) delete process.env[name]; else process.env[name] = before;
    syncEnv();
  }
  Object.assign(process.env, { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" });
  syncEnv();
  assert.equal(inngest.env, "main", "SDK infers a branch even on production");
  await dispatchInteractiveRun("chat", "production-reply");
  assert.equal(invokes, 2); assert.equal(events.length, 0);
  process.env.VERCEL_ENV = "preview";
  syncEnv();
  await dispatchInteractiveRun("chat", "preview-reply");
  assert.equal(invokes, 2); assert.equal(events.length, 1); events.pop();
  Object.assign(process.env, { VERCEL_ENV: "production", INNGEST_ENV: "explicit-environment" });
  syncEnv();
  await dispatchInteractiveRun("chat", "explicit-reply");
  assert.equal(invokes, 2); assert.equal(events.length, 1);
});
