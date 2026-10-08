import test from "node:test";
import assert from "node:assert/strict";
import { unmatchedPendingMessages } from "../app/pending-messages";
test("acknowledged messages never render alongside their temporary copy", () => {
  const pending = [{ id: "temporary", text: "Hi", existingIds: ["old"] }];
  assert.deepEqual(unmatchedPendingMessages(pending, [{ id: "old", kind: "user", text: "Hi" }]), pending);
  assert.deepEqual(unmatchedPendingMessages(pending, [{ id: "new", kind: "user", text: "Hi" }]), []);
});
test("one acknowledgement does not consume two identical sends", () => {
  const pending = [{ id: "one", text: "Hi", existingIds: [] }, { id: "two", text: "Hi", existingIds: [] }];
  assert.deepEqual(unmatchedPendingMessages(pending, [{ id: "new", kind: "user", text: "Hi" }]), [pending[1]]);
});

test("photo acknowledgement preserves the already visible local image", async () => {
  const { attachmentPreview, photoSource, clearPhotoPreviews } = await import('../app/attachment-preview');
  const file = new File(['photo'], 'pizza.jpg', { type: 'image/jpeg' });
  const before = attachmentPreview(file);
  const received = [{ id: 'ack', kind: 'user' as const, text: 'Thx!', photos: [{ id: 'photo', url: 'https://example.com/private-photo', description: 'Pizza' }] }];
  assert.deepEqual(unmatchedPendingMessages([{ text: 'Thx!', existingIds: [], localFiles: [file] }], received), []);
  assert.equal(photoSource(received[0].photos[0].url), before);
  clearPhotoPreviews();
  assert.equal(photoSource(received[0].photos[0].url), received[0].photos[0].url);
});
