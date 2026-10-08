import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRunStore } from '../lib/harness/store';
import { sendAttachments } from '../lib/harness/attachments';
import { threadItems } from '../lib/harness/thread';
import { artifactResponse } from '../lib/harness/artifact-response';
import { combineMessageResults } from '../lib/message-results';

test('all file types can be explicitly delivered, retained and downloaded without exposing intermediate files', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'file-owner', decisionId: null, category: 'social', request: 'Send the files', title: 'Files', metadata: {} });
  await store.updateRun(run.id, { status: 'running' });
  await store.appendMessages(run.id, [{ role: 'user', content: run.request }]);
  const names = ['report.pdf', 'budget.xlsx', 'letter.docx', 'slides.pptx', 'data.csv', 'source.zip', 'audio.mp3', 'model.custom', 'drawing.svg', 'README'];
  const artifacts = await Promise.all(names.map(name => store.createArtifact({ runId: run.id, actionId: null, name, mimeType: 'application/octet-stream', bytesBase64: Buffer.from(`contents of ${name}`).toString('base64') })));
  assert.equal(threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id)).length, 1);
  const data = { attachments: artifacts.map(file => ({ artifactId: file.id, description: `Your ${file.name}` })), caption: 'Your files are ready.' };
  const sent = await sendAttachments(store, run.id, data);
  assert.equal((await sendAttachments(store, run.id, data)).alreadySent, true);
  // Runtime continuation doesn't turn a retry into a new user request.
  await store.appendMessages(run.id, [{ role: 'user', content: '[runtime] Continue' }]);
  assert.equal((await sendAttachments(store, run.id, data)).alreadySent, true);
  const snapshot = (await store.getSnapshot(run.id))!;
  const items = threadItems(snapshot, await store.listMessages(run.id));
  const delivered = items.find(item => item.id === sent.messageId);
  assert.ok(delivered?.kind === 'agent');
  assert.deepEqual(delivered.files?.map(file => file.name), names);
  assert.equal(delivered.fileCaption, data.caption);
  assert.deepEqual(combineMessageResults(items).find(item => item.id === sent.messageId), delivered);
  for (const file of artifacts) {
    const response = artifactResponse(new Request('https://dash.test/artifact?download=1'), file);
    assert.match(response.headers.get('content-disposition')!, /^attachment;/);
    assert.equal(await response.text(), `contents of ${file.name}`);
  }
  await store.appendMessages(run.id, [{ role: 'user', content: 'Send them again' }]);
  assert.notEqual((await sendAttachments(store, run.id, data)).messageId, sent.messageId);
});

test('file delivery rejects missing and foreign artifacts, duplicates, stopped runs and aborted requests', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'owner', decisionId: null, category: 'social', request: 'Files', title: 'Files', metadata: {} });
  const other = await store.createRun({ userId: 'other', decisionId: null, category: 'social', request: 'Files', title: 'Files', metadata: {} });
  await store.updateRun(run.id, { status: 'running' });
  const foreign = await store.createArtifact({ runId: other.id, actionId: null, name: 'private.txt', mimeType: 'text/plain', bytesBase64: 'cHJpdmF0ZQ==' });
  const data = { attachments: [{ artifactId: foreign.id, description: 'Private file' }], caption: '' };
  await assert.rejects(sendAttachments(store, run.id, data), /from this conversation/);
  await assert.rejects(sendAttachments(store, run.id, { ...data, attachments: [{ artifactId: 'missing', description: 'Missing' }] }), /from this conversation/);
  const file = await store.createArtifact({ runId: run.id, actionId: null, name: 'empty.txt', mimeType: 'text/plain', bytesBase64: '' });
  data.attachments[0].artifactId = file.id;
  await assert.rejects(sendAttachments(store, run.id, { ...data, attachments: [...data.attachments, ...data.attachments] }), /only once/);
  await assert.rejects(sendAttachments(store, run.id, data, AbortSignal.abort()), /no longer running/);
  await store.updateRun(run.id, { status: 'cancelled' });
  await assert.rejects(sendAttachments(store, run.id, data), /no longer running/);
  assert.deepEqual(await store.listMessages(run.id), []);
});
