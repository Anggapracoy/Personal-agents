import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRunStore } from "../lib/harness/store";
import { sendAttachments } from "../lib/harness/attachments";
import { threadItems } from "../lib/harness/thread";
import { artifactResponse } from "../lib/harness/artifact-response";
import { videoMimeForName } from "../lib/harness/video-format";

test("video delivery persists explicitly, deduplicates retry, supports legacy MP4 and rejects foreign/non-video artifacts", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "video-owner", decisionId: null, category: "social", request: "Send my clip", title: "Clip", metadata: {} });
  await store.updateRun(run.id, { status: "running" });
  await store.appendMessages(run.id, [{ role: "user", content: run.request }]);
  const video = await store.createArtifact({ runId: run.id, actionId: null, name: "clip.mp4", mimeType: "application/octet-stream", bytesBase64: "dmlkZW8=" });
  assert.equal(threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id)).length, 1);
  const data = { attachments: [{ artifactId: video.id, description: "Our stadium clip" }], caption: "Here it is." };
  const sent = await sendAttachments(store, run.id, data);
  assert.equal((await sendAttachments(store, run.id, data)).alreadySent, true);
  const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.deepEqual(items.at(-1), { id: sent.messageId, kind: "agent", text: data.caption, videoCaption: data.caption, createdAt: (await store.listMessages(run.id)).at(-1)!.createdAt, videos: [{ id: video.id, url: `/api/runs/${run.id}/artifacts/${video.id}`, name: "clip.mp4", description: "Our stadium clip" }] });
  await store.appendMessages(run.id, [{ role: "user", content: "Send it again" }]);
  assert.notEqual((await sendAttachments(store, run.id, data)).messageId, sent.messageId);
  const other = await store.createRun({ userId: "other", decisionId: null, category: "social", request: "Clip", title: "Clip", metadata: {} });
  await assert.rejects(sendAttachments(store, other.id, data), /from this conversation/);
  const image = await store.createArtifact({ runId: run.id, actionId: null, name: "not-video.mp4", mimeType: "image/png", bytesBase64: "aW1hZ2U=" });
  await sendAttachments(store, run.id, { ...data, attachments: [{ artifactId: image.id, description: "Image despite its filename" }] });
  assert.equal(threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id)).filter(item => item.kind === "agent").at(-1)?.photos?.[0].id, image.id);
  await assert.rejects(sendAttachments(store, run.id, { ...data, attachments: [data.attachments[0], data.attachments[0]] }), /only once/);
  await store.updateRun(run.id, { status: "cancelled" });
  await assert.rejects(sendAttachments(store, run.id, { ...data, caption: "Changed caption" }), /no longer running/);
});

const artifact = { name: "clip.mp4", mimeType: "application/octet-stream", bytesBase64: Buffer.from("0123456789").toString("base64") };
const request = (range?: string, suffix = "", method = "GET") => new Request(`https://dash.test/api/runs/one/artifacts/clip${suffix}`, { method, headers: range ? { range } : {} });
test("video delivery serves inline, supports browser seeking, and preserves explicit downloads", async () => {
  assert.equal(videoMimeForName("CLIP.MP4"), "video/mp4");
  const full = artifactResponse(request(), artifact);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.match(full.headers.get("content-disposition")!, /^inline/);
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(await full.text(), "0123456789");
  for (const [range, expected, contentRange] of [["bytes=0-1", "01", "bytes 0-1/10"], ["bytes=6-", "6789", "bytes 6-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-100", "89", "bytes 8-9/10"]]) {
    const response = artifactResponse(request(range), artifact);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(response.headers.get("content-length"), String(expected.length));
    assert.equal(await response.text(), expected);
  }
  for (const range of ["bytes=10-", "bytes=5-2", "bytes=-0"]) {
    const response = artifactResponse(request(range), artifact);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  }
  assert.equal(artifactResponse(request("bytes=0-1,4-5"), artifact).status, 200);
  assert.match(artifactResponse(request(undefined, "?download=1"), artifact).headers.get("content-disposition")!, /^attachment/);
  const head = artifactResponse(request(undefined, "", "HEAD"), artifact);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");
  const html = artifactResponse(request(), { ...artifact, name: "document.html", mimeType: "text/html" });
  assert.match(html.headers.get("content-disposition")!, /^attachment/);
  assert.equal(html.headers.get("accept-ranges"), null);
});
