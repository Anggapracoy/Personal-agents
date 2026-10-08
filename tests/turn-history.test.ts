import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { loadTurnHistory } from "../lib/harness/turn-history";
import { attachSharedIntakeFiles } from "../lib/harness/shared-intake-files";

class CountingStore extends MemoryRunStore {
  reads = 0;
  override async listMessages(id: string) { this.reads++; return super.listMessages(id); }
}
const create = (store: MemoryRunStore, metadata: Record<string, unknown> = {}) => store.createRun({
  userId: "history@test.invalid", decisionId: null, category: "test", title: "Test", request: "Initial request", metadata,
});

test("ordinary startup reads history once and a later turn sees newly saved messages", async () => {
  const store = new CountingStore();
  const run = await create(store);
  await store.appendMessages(run.id, [{ role: "user", content: "First" }]);
  store.reads = 0;
  const first = await loadTurnHistory(store, run);
  assert.equal(store.reads, 1);
  assert.equal(first.messages.length, 1);
  await store.appendMessages(run.id, [{ role: "user", content: "New instruction" }]);
  store.reads = 0;
  const next = await loadTurnHistory(store, run);
  assert.equal(store.reads, 1);
  assert.equal(next.messages.at(-1)?.message.content, "New instruction");
  assert.equal(next.taskStartedAt, Date.parse(next.messages.at(-1)!.createdAt));
});

test("history includes shared files and a user message arriving during attachment setup", async () => {
  const store = new MemoryRunStore();
  const run = await create(store, { executionContext: { sharedIntake: { intakeId: "test-intake" } } });
  await store.appendMessages(run.id, [{ role: "user", content: "Read the file" }]);
  const loaded = await loadTurnHistory(store, run, (store, run) => attachSharedIntakeFiles(store, run, async () => {
    await store.appendMessages(run.id, [{ role: "user", content: "Focus on the image" }]);
    return [{ name: "photo.jpg", mimeType: "image/jpeg", dataBase64: Buffer.from("image-bytes").toString("base64") }];
  }));
  assert.equal(loaded.messages.length, 3);
  assert.equal(loaded.messages[1].message.content, "Focus on the image");
  assert.match(JSON.stringify(loaded.messages[2].message), /"type":"image"/);
  assert.equal(loaded.taskStartedAt, Date.parse(loaded.messages[1].createdAt));
  assert.equal((loaded.run.metadata.sharedIntakeAttachmentIds as string[]).length, 1);
});

test("new chats retain their creation time and attachment failures stop history loading", async () => {
  const store = new CountingStore();
  const run = await create(store);
  assert.equal((await loadTurnHistory(store, run)).taskStartedAt, Date.parse(run.createdAt));
  store.reads = 0;
  await assert.rejects(loadTurnHistory(store, run, async () => { throw new Error("Source unavailable"); }), /Source unavailable/);
  assert.equal(store.reads, 0);
});
