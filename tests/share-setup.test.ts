import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRunStore } from '../lib/harness/store';
import { finishShareSetup } from '../lib/harness/share-setup';

for (const failure of ['upload', 'secrets', 'dispatch'] as const) {
  test(`share retry recovers ${failure} failure without duplicating saved attachments`, async () => {
    const store = new MemoryRunStore();
    const run = await store.createRun({ userId: 'share-test', decisionId: null, title: 'Share', request: 'Read', category: 'social', metadata: {} });
    const original = store.createArtifact.bind(store);
    let uploads = 0, fail = true, dispatched = 0;
    store.createArtifact = async input => {
      uploads++;
      if (failure === 'upload' && uploads === 2 && fail) throw Error('upload failed');
      return original(input);
    };
    const input = { store, runId: run.id,
      files: ['first', 'second'].map(name => ({ name, mimeType: 'text/plain', dataBase64: Buffer.from(name).toString('base64') })),
      attachSecrets: async () => { if (failure === 'secrets' && fail) throw Error('secrets failed'); },
      dispatch: async (_id: string, eventId: string) => { assert.equal(eventId, `share-start:${run.id}`); if (failure === 'dispatch' && fail) throw Error('dispatch failed'); dispatched++; },
    };
    await assert.rejects(finishShareSetup(input));
    assert.notEqual((await store.getRun(run.id))?.metadata.shareSetupComplete, true);
    fail = false;
    await finishShareSetup(input);
    await finishShareSetup(input);
    const snapshot = (await store.getSnapshot(run.id))!;
    assert.equal(snapshot.artifacts.length, 2);
    assert.equal((snapshot.metadata.initialAttachmentIds as string[]).length, 2);
    assert.equal(snapshot.metadata.shareSetupComplete, true);
    assert.equal(dispatched, 1);
  });
}
