import { z } from 'zod';
import { isRuntimeMessage } from './runtime-message';
import { videoMimeForArtifact } from './video-format';
import type { RunStore } from './types';

const entries = z.array(z.object({ artifactId: z.string().min(1), description: z.string().min(1).max(300) })).min(1).max(10);
const caption = z.string().max(1000).default('');
export const attachmentMessageSchema = z.object({ attachments: entries, caption });
// Persisted display formats remain readable by existing web and native clients.
export const photoMessageSchema = z.object({ photos: entries, caption });
export const videoMessageSchema = z.object({ videos: entries, caption });
export const fileMessageSchema = z.object({ files: entries, caption });
export const photoMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Validate everything before publishing, then retain the existing display formats. */
export async function sendAttachments(store: RunStore, runId: string, input: z.input<typeof attachmentMessageSchema>, signal?: AbortSignal) {
  const data = attachmentMessageSchema.parse(input);
  const ids = data.attachments.map(item => item.artifactId);
  if (new Set(ids).size !== ids.length) throw new Error('Choose each attachment only once.');
  type Kind = 'photos' | 'videos' | 'files';
  const groups: { kind: Kind; items: typeof data.attachments; names: string[] }[] = [];
  for (const item of data.attachments) {
    const artifact = await store.getArtifact(item.artifactId, runId);
    if (!artifact) throw new Error('Attachment must be a saved artifact from this conversation.');
    const kind: Kind = photoMimeTypes.has(artifact.mimeType) ? 'photos' : videoMimeForArtifact(artifact) ? 'videos' : 'files';
    // Contiguous groups preserve the requested order, including mixed batches.
    let group = groups.at(-1);
    if (group?.kind !== kind) { group = { kind, items: [], names: [] }; groups.push(group); }
    group.items.push(item);
    group.names.push(artifact.name);
  }
  const messages = await store.listMessages(runId);
  const userSeq = messages.filter(item => item.message.role === 'user' && !isRuntimeMessage(item.message)).at(-1)?.seq ?? 0;
  const prior = messages.filter(item => item.seq > userSeq && JSON.stringify(item.message.providerOptions?.wdyt?.attachmentDelivery) === JSON.stringify(data));
  if (prior.length) return { sent: true, messageId: prior[0].id, messageIds: prior.map(item => item.id), alreadySent: true, attachmentCount: ids.length };
  if (signal?.aborted || (await store.getRun(runId))?.status !== 'running') throw new Error('Conversation is no longer running.');
  const sent = await store.appendMessages(runId, groups.map((group, index) => {
    const messageCaption = index === groups.length - 1 ? data.caption : '';
    const key = { photos: 'photoMessage', videos: 'videoMessage', files: 'fileMessage' }[group.kind];
    const fallback = group.kind === 'files' && group.items.length === 1 ? group.names[0] : group.items.length === 1 ? (group.kind === 'photos' ? 'Photo' : 'Video') : `${group.items.length} ${group.kind}`;
    return { role: 'assistant' as const, content: messageCaption || fallback, providerOptions: { wdyt: { [key]: { [group.kind]: group.items, caption: messageCaption }, attachmentDelivery: data } } };
  }));
  return { sent: true, messageId: sent[0].id, messageIds: sent.map(item => item.id), attachmentCount: ids.length };
}
