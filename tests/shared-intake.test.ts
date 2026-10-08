import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackDecision, intakeDecisionSchema } from '../lib/shared-intake';

test('attachment fallback remains valid when model analysis fails', () => {
  const result = fallbackDecision('', [{name:'photo.jpg',mimeType:'image/jpeg',size:1,dataBase64:'YQ=='}]);
  assert.equal(result.iconKind, 'doc');
  assert.ok(result.title);
  assert.ok(result.options.length >= 2);
});

import { normalizeSharedIntakeFile, sharedIntakeId } from '../lib/shared-intake';
import { attachSharedIntakeFiles } from '../lib/harness/shared-intake-files';
import { MemoryRunStore } from '../lib/harness/store';
import { chatFileContent, loadChatFiles } from '../lib/harness/chat-files';
import { threadItems } from '../lib/harness/thread';

test('share retry identity is stable, owner scoped, and separate from a new intentional share', () => {
  assert.equal(sharedIntakeId('A@Test.Invalid', 'share-1'), sharedIntakeId('a@test.invalid', 'share-1'));
  assert.notEqual(sharedIntakeId('a@test.invalid', 'share-1'), sharedIntakeId('b@test.invalid', 'share-1'));
  assert.notEqual(sharedIntakeId('a@test.invalid', 'share-1'), sharedIntakeId('a@test.invalid', 'share-2'));
});

for (const existing of [false, true]) test(`shared image bytes reach the model and opening survives replies (${existing ? 'existing' : 'new'} chat)`, async () => {
  const store = new MemoryRunStore();
  let run = await store.createRun({ userId: 'owner@test.invalid', decisionId: 'shared-test', title: 'Photo', category: 'social', request: 'What is in this picture?', metadata: {
    sourceType: 'manual', userMessage: 'What is in this picture?', retryDecision: { subtitle: 'What do you want me to do with it?' },
    executionContext: { sharedIntake: { intakeId: 'intake-1' } },
  } });
  if (existing) await store.appendMessages(run.id, [{ role: 'user', content: 'What is in this picture?' }, { role: 'assistant', content: 'I only have the filename.' }]);
  let reads = 0;
  const readFiles = async (owner: string, metadata: Record<string, unknown>) => {
    reads++; assert.equal(owner, 'owner@test.invalid'); assert.deepEqual(metadata.executionContext, { sharedIntake: { intakeId: 'intake-1' } });
    return [{ name: 'photo.jpg', mimeType: 'image/jpeg', dataBase64: Buffer.from('actual-image-bytes').toString('base64') }];
  };
  run = await attachSharedIntakeFiles(store, run, readFiles);
  run = await attachSharedIntakeFiles(store, run, readFiles);
  assert.equal(reads, 1);
  const files = await loadChatFiles(store, run.id);
  assert.equal(files.length, 1);
  const image = chatFileContent(files).find(part => part.type === 'image');
  assert.ok(image && image.type === 'image');
  assert.equal(image.image, Buffer.from('actual-image-bytes').toString('base64'));
  if (!existing) await store.appendMessages(run.id, [{ role: 'user', content: [{ type: 'text', text: run.request }, ...chatFileContent(files)] }]);
  else assert.match(JSON.stringify((await store.listMessages(run.id)).at(-1)), /"type":"image"/);
  await store.appendMessages(run.id, [{ role: 'user', content: 'Please describe it.' }, { role: 'assistant', content: 'Here is what I see.' }]);
  const items = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
  assert.equal(items.filter(item => item.kind === 'agent' && item.text === 'What do you want me to do with it?').length, 1);
  assert.equal(items.filter(item => item.kind === 'user' && item.photos?.length).length, 1);
  assert.doesNotMatch(JSON.stringify(items), /\[runtime\]|actual-image-bytes/);
});

test('an unavailable shared source stops before creating filename-only artifacts', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'other@test.invalid', decisionId: null, title: 'Photo', category: 'social', request: 'Describe', metadata: { executionContext: { sharedIntake: { intakeId: 'private-intake' } } } });
  await assert.rejects(attachSharedIntakeFiles(store, run, async () => { throw new Error('Shared item is unavailable for this account.'); }), /unavailable/);
  assert.equal((await store.getSnapshot(run.id))!.artifacts.length, 0);
});

test('legacy generic image types recover from retained bytes without trusting the filename', () => {
  const jpeg = normalizeSharedIntakeFile({ name: 'IMG_1234', mimeType: 'application/octet-stream', size: 4, dataBase64: Buffer.from([255, 216, 255, 224]).toString('base64') });
  assert.equal(jpeg.mimeType, 'image/jpeg');
  const unknown = normalizeSharedIntakeFile({ name: 'not-really-a-photo.jpg', mimeType: 'application/octet-stream', size: 4, dataBase64: Buffer.from('text').toString('base64') });
  assert.equal(unknown.mimeType, 'application/octet-stream');
});

import { z } from 'zod';
test('intake analysis response schema requires every option field for strict model output', () => {
  const schema = z.toJSONSchema(intakeDecisionSchema) as any;
  const option = schema.properties.options.items;
  assert.deepEqual([...option.required].sort(), Object.keys(option.properties).sort());
  assert.equal(intakeDecisionSchema.parse({ ...fallbackDecision('test image', []), options: [{ label: 'Read it', sublabel: null, actionType: 'research' }, { label: 'Keep it', sublabel: null, actionType: 'instant' }] }).options[0].sublabel, null);
});
