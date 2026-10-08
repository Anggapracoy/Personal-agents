import type { ModelMessage } from "ai";
import type { AgentRunSnapshot } from "./types";
import { fileDescription, uploadedFileName } from "../file-display";
export type MessageFile = { id: string; url: string; name: string; mimeType: string; description: string };

/** Only resolve this message's owned uploads; never render arbitrary client URLs. */
export function userFiles(snapshot: AgentRunSnapshot, message?: ModelMessage): MessageFile[] {
  const ids = message ? message.providerOptions?.wdyt?.attachmentIds : snapshot.metadata.initialAttachmentIds;
  const names = message ? message.providerOptions?.wdyt?.attachmentNames : snapshot.metadata.initialAttachmentNames;
  const selected = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  return snapshot.artifacts.filter(file => selected.includes(file.id) && file.actionId === null && !file.mimeType.startsWith("image/")).map(file => {
    const original = names && typeof names === "object" && !Array.isArray(names) ? (names as Record<string, unknown>)[file.id] : undefined;
    const name = typeof original === "string" && original.trim() ? original : uploadedFileName(file.name);
    return { id: file.id, url: `/api/runs/${snapshot.id}/artifacts/${file.id}`, name, mimeType: file.mimeType, description: fileDescription(name, file.mimeType) };
  });
}
