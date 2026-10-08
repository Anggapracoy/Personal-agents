import type { ModelMessage } from "ai";
import type { AgentRunSnapshot } from "./types";
export type MessagePhoto = { id: string; url: string; description: string };

/** Resolve only this conversation's saved uploads, never arbitrary client URLs. */
export function userPhotos(snapshot: AgentRunSnapshot, message?: ModelMessage): MessagePhoto[] {
  const ids = message ? message.providerOptions?.wdyt?.attachmentIds : snapshot.metadata.initialAttachmentIds;
  const selected = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  return snapshot.artifacts.filter(file => selected.includes(file.id) && file.actionId === null && file.mimeType.startsWith("image/")).map(file => ({ id: file.id, url: `/api/runs/${snapshot.id}/artifacts/${file.id}`, description: "Photo you sent" }));
}
