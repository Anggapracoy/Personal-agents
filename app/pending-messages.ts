import { retainPhotoPreview } from "./attachment-preview";
import type { ThreadItem } from "../lib/harness/thread";
/** Match each acknowledgement once, before paint, including repeated identical sends. */
export function unmatchedPendingMessages<T extends { text: string; existingIds: string[]; localFiles?: File[] }>(pending: T[], received: ThreadItem[]): T[] {
  const matched = new Set<string>();
  return pending.filter(message => {
    const match = received.find(item => item.kind === "user" && item.text === message.text && !message.existingIds.includes(item.id) && !matched.has(item.id));
    if (match) {
      matched.add(match.id);
      if (match.kind === "user") {
        const photos = message.localFiles?.filter(file => file.type.startsWith("image/")) ?? [];
        match.photos?.forEach((photo, index) => { if (photos[index]) retainPhotoPreview(photo.url, photos[index]); });
      }
    }
    return !match;
  });
}
