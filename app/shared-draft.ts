import type { SharedIntakeDetail } from './workspace-model';

export type SharedDraft = { text: string; files: File[] };

/** Receiving a share only stages a draft. The normal Send flow owns uploads/runs. */
export function appendSharedDraft(draft: SharedDraft, detail: SharedIntakeDetail): SharedDraft {
  const sharedText = (detail.text ?? '').trim();
  const url = (detail.url ?? '').trim();
  const addition = [sharedText, url && !sharedText.split(/\s+/).includes(url) ? url : ''].filter(Boolean).join('\n\n');
  const text = [draft.text, addition].filter(Boolean).join('\n\n');
  if (text.length > 4000) throw new Error('This shared text is too long. Shorten your draft and share it again.');
  const incoming = detail.files ?? [];
  if (draft.files.length + incoming.length > 6) throw new Error('Attach up to 6 files, 3 MB total. Remove an attachment and share again.');
  const files = incoming.map(file => {
    if (!file.name || typeof file.dataBase64 !== 'string' || file.dataBase64.length > 4 * 1024 * 1024) throw new Error('That shared file could not be attached. Share it again.');
    const bytes = Uint8Array.from(atob(file.dataBase64), character => character.charCodeAt(0));
    return new File([bytes], file.name, { type: file.mimeType || 'application/octet-stream' });
  });
  if (draft.files.reduce((sum, file) => sum + file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > 3 * 1024 * 1024) throw new Error('Attach up to 6 files, 3 MB total. Remove an attachment and share again.');
  if (!addition && !files.length) throw new Error('That shared item could not be attached. Share it again.');
  return { text, files: [...draft.files, ...files] };
}
