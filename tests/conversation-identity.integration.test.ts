import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import { PostgresRunStore } from "../lib/harness/store";

const databaseUrl = process.env.CONVERSATION_IDENTITY_TEST_DATABASE_URL;
test("conversation identity updates are atomic in PostgreSQL", { skip: !databaseUrl }, async () => {
  const admin = postgres(databaseUrl!, { prepare: false, onnotice: () => {} });
  const schema = `identity_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create schema ${schema}`);
  const sql = postgres(databaseUrl!, { prepare: false, connection: { search_path: schema }, onnotice: () => {} });
  try {
    for (const file of ["0002_agent_harness.sql", "0003_agent_results_and_secrets.sql"]) await sql.unsafe(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    const store = new PostgresRunStore(databaseUrl!, sql);
    const input = { userId: "owner@example.com", decisionId: "manual", category: "social", request: "Find flights to NYC", title: "Find flights to NYC", metadata: { initialConversationTitle: "Find flights to NYC", sourceType: "manual", retryDecision: { title: "Find flights to NYC", category: "social", executionContext: { sourceAccountId: "work" } } } };
    const run = await store.createRun(input);
    assert.equal(await store.setConversationIdentity(run.id, "other@example.com", run.title, { title: "Wrong owner", category: "social" }), null);
    const results = await Promise.all([
      store.setConversationIdentity(run.id, run.userId, run.title, { title: "NYC Flights", category: "travel" }),
      store.setConversationIdentity(run.id, run.userId, run.title, { title: "Other Title", category: "travel" }),
      store.updateRun(run.id, { status: "done", response: "The latest reply" }),
      store.updateRunMetadata(run.id, { actionScopeId: "occurrence" }),
    ]);
    assert.equal(results.slice(0, 2).filter(Boolean).length, 1);
    const saved = (await store.getRun(run.id))!;
    assert.equal(saved.category, "travel"); assert.equal(saved.status, "done"); assert.equal(saved.response, "The latest reply");
    assert.equal(saved.metadata.actionScopeId, "occurrence");
    assert.equal((saved.metadata.retryDecision as { executionContext: { sourceAccountId: string } }).executionContext.sourceAccountId, "work");
    const renamed = await store.createRun(input);
    await store.updateRun(renamed.id, { title: "My own title" });
    assert.equal(await store.setConversationIdentity(renamed.id, renamed.userId, renamed.title, { title: "NYC Flights", category: "travel" }), null);
  } finally {
    await sql.end(); await admin.unsafe(`drop schema ${schema} cascade`); await admin.end();
  }
});
