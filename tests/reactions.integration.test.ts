import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { PostgresRunStore } from "../lib/harness/store";
import { reactionMessage, reactionOf } from "../lib/harness/reactions";
import { pendingSteering } from "../lib/harness/steering";
import { threadItems } from "../lib/harness/thread";
const url = process.env.SCHEDULE_TEST_DATABASE_URL;

test("PostgreSQL reactions serialize duplicate delivery, concurrent changes, and finalization", { skip: !url }, async () => {
  const admin = postgres(url!, { prepare: false, onnotice: () => {} });
  const schema = `reaction_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create schema ${schema}`);
  const sql = postgres(url!, { prepare: false, connection: { search_path: schema }, onnotice: () => {} });
  try {
    for (const file of ["0002_agent_harness.sql", "0003_agent_results_and_secrets.sql", "0015_agent_messages.sql", "0016_scheduled_tasks.sql"]) await sql.unsafe(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    const store = new PostgresRunStore(url!, sql);
    const run = await store.createRun({ userId: "reaction@test.invalid", decisionId: null, request: "Names", title: "Names", category: "social", metadata: {} });
    const [target] = await store.appendMessages(run.id, [{ role: "assistant", content: "want three names?" }]);
    await store.updateRun(run.id, { status: "done" });
    const event = reactionMessage({ eventId: crypto.randomUUID(), messageId: target.id, emoji: "👍" }, "user", "want three names?");
    const results = await Promise.all(Array.from({ length: 12 }, () => store.acceptReaction(run.id, event)));
    assert.equal(results.filter(result => result === "started").length, 1);
    assert.equal(results.filter(result => result === "duplicate").length, 11);
    assert.equal((await store.listMessages(run.id)).length, 2);
    const changes = ["❤️", "😂", "🙏", "😊"].map(emoji => reactionMessage({ eventId: crypto.randomUUID(), messageId: target.id, emoji }, "user", "want three names?"));
    await Promise.all(changes.map(message => store.acceptReaction(run.id, message)));
    assert.equal(pendingSteering(await store.getRun(run.id)).length, 4);
    assert.equal(await store.finishRunIfNoSteering(run.id, null), false);
    const consume = await Promise.all([store.consumeSteering(run.id), store.consumeSteering(run.id)]);
    assert.equal(consume.filter(Boolean).length, 1);
    const all = await store.listMessages(run.id);
    assert.deepEqual(all.map(message => message.seq), [1,2,3,4,5,6]);
    const items = threadItems((await store.getSnapshot(run.id))!, all);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind === "agent" && items[0].reactions?.[0].emoji, reactionOf(all.at(-1)!.message)?.emoji);
    await store.finishRunIfNoSteering(run.id, null);
    assert.equal(await store.acceptReaction(run.id, event), "duplicate");
    assert.equal((await store.getRun(run.id))?.status, "done");
    const sameState = reactionMessage({ ...reactionOf(all.at(-1)!.message)!, eventId: crypto.randomUUID() }, "user", "want three names?");
    assert.equal(await store.acceptReaction(run.id, sameState), "duplicate");
    assert.equal((await store.getRun(run.id))?.status, "done");
  } finally {
    await sql.end();
    await admin.unsafe(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
