import { sharedIntakeFiles } from '../shared-intake';
import { chatFileContent, parseChatFiles, saveChatFiles } from './chat-files';
import type { AgentRun, RunStore } from './types';

/** Run workers serialize by run ID. Resolve source bytes only through the owner's saved intake. */
export async function attachSharedIntakeFiles(store: RunStore, run: AgentRun, readFiles = sharedIntakeFiles): Promise<AgentRun> {
  const context = run.metadata.executionContext as { sharedIntake?: unknown } | undefined;
  if (!context?.sharedIntake || Array.isArray(run.metadata.sharedIntakeAttachmentIds)) return run;
  const files = parseChatFiles(await readFiles(run.userId, run.metadata));
  const attachments = await saveChatFiles(store, run.id, files);
  const metadata = {
    sharedIntakeAttachmentIds: attachments.map(file => file.id),
    initialAttachmentNames: { ...(run.metadata.initialAttachmentNames as Record<string, string> ?? {}), ...Object.fromEntries(attachments.map((file, index) => [file.id, files[index].name])) },
    initialAttachmentIds: [...(Array.isArray(run.metadata.initialAttachmentIds) ? run.metadata.initialAttachmentIds : []), ...attachments.map(file => file.id)],
  };
  // Repair older chats and notification-created first turns whose history is already seeded.
  // This context is hidden from the transcript; the original user turn renders the retained photo.
  if (attachments.length && await store.hasMessages(run.id)) {
    await store.appendMessages(run.id, [{ role: 'user', content: [
      { type: 'text', text: '[runtime] These are the original files the user shared for this conversation. Use the actual attached content when answering their request.' },
      ...chatFileContent(attachments),
    ] }]);
  }
  await store.updateRunMetadata(run.id, metadata);
  return { ...run, metadata: { ...run.metadata, ...metadata } };
}
