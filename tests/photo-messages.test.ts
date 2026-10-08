import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRunStore } from "../lib/harness/store";
import { sendAttachments } from "../lib/harness/attachments";
import { threadItems } from "../lib/harness/thread";

test("photo delivery persists in the thread, deduplicates retries, and permits a later resend", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "photos-test", decisionId: null, category: "travel", request: "Send the photos", title: "Photos", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  await store.appendMessages(run.id, [{ role: "user", content: run.request }]);
  const photo = await store.createArtifact({ runId: run.id, actionId: null, name: "mountain.png", mimeType: "image/png", bytesBase64: "aW1hZ2U=" });
  const data = { attachments: [{ artifactId: photo.id, description: "Mountain at sunset" }], caption: "Here’s the view." };
  const sent = await sendAttachments(store, run.id, data);
  assert.equal(sent.sent, true);
  assert.equal((await sendAttachments(store, run.id, data)).alreadySent, true);
  const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.deepEqual(items.at(-1), { id: sent.messageId, kind: "agent", text: data.caption, photoCaption: data.caption, createdAt: (await store.listMessages(run.id)).at(-1)!.createdAt, photos: [{ id: photo.id, url: `/api/runs/${run.id}/artifacts/${photo.id}`, description: "Mountain at sunset" }] });
  await store.appendMessages(run.id, [{ role: "user", content: "Send it again" }]);
  assert.notEqual((await sendAttachments(store, run.id, data)).messageId, sent.messageId);
  const other = await store.createRun({ userId: "other", decisionId: null, category: "travel", request: "Photos", title: "Photos", metadata: {} });
  await store.updateRun(other.id, { status: "running" });
  await assert.rejects(sendAttachments(store, other.id, data), /from this conversation/);
  const pdf = await store.createArtifact({ runId: run.id, actionId: null, name: "document.pdf", mimeType: "application/pdf", bytesBase64: "cGRm" });
  await sendAttachments(store, run.id, { ...data, attachments: [{ artifactId: pdf.id, description: "Document" }] });
  assert.equal(threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id)).filter(item => item.kind === "agent").at(-1)?.files?.[0].id, pdf.id);
  await store.updateRun(run.id, { status: "cancelled" });
  await assert.rejects(sendAttachments(store, run.id, { ...data, caption: "New caption" }), /no longer running/);
});

test("internal images do not appear as photo messages unless explicitly sent", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "photos-test", decisionId: null, category: "travel", request: "Research", title: "Research", metadata: {} });
  await store.createArtifact({ runId: run.id, actionId: null, name: "browser-frame-test.png", mimeType: "image/png", bytesBase64: "aW1hZ2U=" });
  assert.deepEqual(threadItems((await store.getSnapshot(run.id))!, []), []);
});
