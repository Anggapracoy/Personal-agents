import { createHash } from 'node:crypto';
import type { RunStore } from './types';
import type { parseChatFiles } from './chat-files';

/** Resume incomplete intake before acknowledging a share retry as successful. */
export async function finishShareSetup(input: {
  store: RunStore; runId: string; files: ReturnType<typeof parseChatFiles>;
  attachSecrets: () => Promise<unknown>; dispatch: (id: string, eventId: string) => Promise<unknown>;
}) {
  const { store, runId, files } = input;
  const snapshot = await store.getSnapshot(runId);
  if (!snapshot) throw new Error('Shared conversation not found.');
  if (snapshot.metadata.shareSetupComplete || snapshot.status !== 'planning') return;
  if (!snapshot.metadata.shareAttachmentsReady) {
    const attachments = [];
    for (const [index, file] of files.entries()) {
      const digest = createHash('sha256').update(file.dataBase64).digest('hex').slice(0, 24);
      const name = `uploaded-share-${index}-${digest}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const existing = snapshot.artifacts.find(artifact => artifact.name === name && artifact.mimeType === file.mimeType);
      attachments.push(existing ?? await store.createArtifact({ runId, actionId: null, name, mimeType: file.mimeType, bytesBase64: file.dataBase64 }));
    }
    await store.updateRunMetadata(runId, {
      initialAttachmentIds: attachments.map(file => file.id),
      initialAttachmentNames: Object.fromEntries(attachments.map((file, index) => [file.id, files[index].name])),
      shareAttachmentsReady: true,
    });
  }
  await input.attachSecrets();
  // Stable event ID covers a response lost after Inngest accepted the dispatch.
  await input.dispatch(runId, `share-start:${runId}`);
  await store.updateRunMetadata(runId, { shareSetupComplete: true });
}
