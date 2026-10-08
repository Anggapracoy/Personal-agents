import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { PostgresRunStore } from "../lib/harness/store";
import { pendingSteering } from "../lib/harness/steering";
import { conversationWorkActivity } from "../lib/harness/thread";

const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
test("notification replies are atomic and account scoped in PostgreSQL", { skip: !databaseUrl }, async () => {
  const admin = postgres(databaseUrl!, { prepare: false, onnotice() {} });
  const schema = `notification_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create schema ${schema}`);
  const sql = postgres(databaseUrl!, { prepare: false, connection: { search_path: schema }, onnotice() {} });
  const store = new PostgresRunStore(databaseUrl!, sql);
  try {
    for (const file of ["0002_agent_harness.sql", "0003_agent_results_and_secrets.sql", "0015_agent_messages.sql"])
      await sql.unsafe(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    const input = { owner: "owner@example.com", decisionId: "dinner", eventId: crypto.randomUUID(), text: "Tomorrow instead", newRun: { title: "Dinner", category: "social", request: "Tomorrow instead", metadata: {} } };
    const created = await Promise.all(Array.from({ length: 8 }, () => store.acceptNotificationReply(input)));
    assert.equal(new Set(created.map(result => result?.run.id)).size, 1);
    assert.equal(created.filter(result => result?.mode === "started").length, 1);
    const id = created[0]!.run.id;
    await store.appendMessages(id, [{ role: "user", content: "Tomorrow instead" }, { role: "assistant", content: "Would seven work?" }]);
    await store.updateRun(id, { status: "done", response: "Would seven work?" });
    await store.updateRunMetadata(id, {toolActivity:{label:'Preparing photos',icon:'photo'},currentActivityActionId:'old',replyTyping:true,taskWorkStarted:true});
    const reply = { owner: input.owner, runId: id, eventId: crypto.randomUUID(), text: "Eight, please." };
    const accepted = await Promise.all(Array.from({ length: 8 }, () => store.acceptNotificationReply(reply)));
    assert.equal(accepted.filter(result => result?.mode === "started").length, 1);
    assert.equal((await store.listMessages(id)).filter(item => item.message.content === reply.text).length, 1);
    assert.equal(pendingSteering(await store.getRun(id)).length, 0);
    assert.deepEqual(conversationWorkActivity((await store.getSnapshot(id))!), {label:'Thinking',icon:'thinking'});
    assert.equal(await store.acceptNotificationReply({ ...reply, owner: "other@example.com" }), null);
    const steer = { ...reply, eventId: crypto.randomUUID(), text: "And somewhere quiet." };
    await Promise.all(Array.from({ length: 6 }, () => store.acceptNotificationReply(steer)));
    assert.equal(pendingSteering(await store.getRun(id)).length, 1);
    await store.consumeSteering(id);
    assert.equal((await store.acceptNotificationReply(steer))?.mode, "duplicate");
    assert.equal((await store.listMessages(id)).filter(item => item.message.content === steer.text).length, 1);
    await store.updateRun(id, { status: "done" });
    await store.acceptNotificationReply(reply);
    assert.equal((await store.getRun(id))?.status, "done");
    const newer = await store.createRun({ userId: input.owner, decisionId: input.decisionId, title: "New dinner task", category: "social", request: "A new request", metadata: {} });
    const retried = await store.acceptNotificationReply(input);
    assert.equal(retried?.run.id, id, "A retry stays with its original receipt even after a newer run exists");
    assert.equal(retried?.mode, "duplicate");
    assert.equal(pendingSteering(await store.getRun(newer.id)).length, 0);
    await store.updateRun(id, {status:'done'});
    await store.updateRunMetadata(id, {toolActivity:{label:'Preparing photos',icon:'photo'},replyTyping:true,taskWorkStarted:true});
    assert.equal(await store.claimRunForReply(id), true);
    assert.deepEqual(conversationWorkActivity((await store.getSnapshot(id))!), {label:'Thinking',icon:'thinking'});
    await store.updateRunMetadata(id, {toolActivity:{label:'Preparing photos',icon:'photo'},replyTyping:true});
    await store.enqueueSteering(id, {role:'user',content:'A different request'});
    assert.deepEqual(conversationWorkActivity((await store.getSnapshot(id))!), {label:'Thinking',icon:'thinking'});
    await store.consumeSteering(id);
    assert.deepEqual(conversationWorkActivity((await store.getSnapshot(id))!), {label:'Thinking',icon:'thinking'});
  } finally {
    await sql.end();
    await admin.unsafe(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
