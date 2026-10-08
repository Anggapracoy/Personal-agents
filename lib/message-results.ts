import type { ThreadItem } from './harness/thread';
import { previewUrl } from './link-preview';

export type MessageResult = { name: string; description: string; sourceUrl: string | null };
/** Fold legacy result rows into their preceding assistant message, including cached transcripts. */
export function combineMessageResults(items: ThreadItem[]): ThreadItem[] {
  const combined: ThreadItem[] = [];
  for (const item of items) {
    if (item.kind !== 'options') { combined.push({ ...item }); continue; }
    let target: Extract<ThreadItem, { kind: 'agent' }> | undefined;
    for (let i = combined.length - 1; i >= 0; i--) {
      const candidate = combined[i];
      if (candidate.kind === 'user' || candidate.kind === 'blocks' || candidate.kind === 'activity') break;
      if (candidate.kind === 'agent' && !candidate.photos?.length && !candidate.videos?.length && !candidate.files?.length) { target = candidate; break; }
    }
    if (!target) { target = { id: item.id, kind: 'agent', text: '' }; combined.push(target); }
    const results = [...(target.results ?? [])];
    for (const option of item.options ?? []) {
      const url = option.sourceUrl && previewUrl(option.sourceUrl);
      if (results.some(result => url ? result.sourceUrl === url : !result.sourceUrl && result.name === option.name)) continue;
      results.push({ name: option.name, description: option.description, sourceUrl: url || null });
    }
    target.results = results;
  }
  return combined;
}
