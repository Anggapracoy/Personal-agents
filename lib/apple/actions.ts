import { normalizeAppleConnections } from "./connection-context";
import { appleResultMessage } from "./result";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { validateAppleRequest } from "./contract";
import type { RunStore } from "../harness/types";

export async function claimAppleAction(store: RunStore, runId: string, actionId: string, owner: string) {
  const run = await store.getRun(runId);
  if (!run || run.userId.toLowerCase() !== owner.toLowerCase() || run.status !== "awaiting_approval") throw new Error("This iPhone action is no longer waiting.");
  const action = await store.getAction(actionId, runId);
  if (!action || action.toolName !== "apple_device" || action.status !== "proposed") throw new Error("This action was already claimed. Retry on the original iPhone to return its saved result; do not run it again.");
  const request = validateAppleRequest(action.input);
  if (request.operation === "photos.save") {
    const artifact = await store.getArtifact(String(request.parameters.artifactId), runId);
    if (!artifact || !["image/jpeg", "image/png", "image/webp", "image/heic"].includes(artifact.mimeType) || artifact.bytesBase64.length > 14_000_000) throw new Error("Choose an image artifact under 10 MB from this conversation.");
  }
  // The conditional approval is the durable, cross-device execution claim.
  const token = randomUUID();
  const claimed = await store.claimDeviceAction(actionId, runId, owner, token);
  if (!claimed) throw new Error("This action was already claimed.");
  return { ...request, token, owner };
}
export async function finishAppleAction(store: RunStore, runId: string, actionId: string, owner: string, token: string, result: Record<string, unknown>) {
  const run = await store.getRun(runId);
  const action = await store.getAction(actionId, runId);
  if (!run || run.userId.toLowerCase() !== owner.toLowerCase() || !action || action.toolName !== "apple_device") throw new Error("This iPhone action was not found.");
  const expected = await store.getSecret(runId, `apple_claim:${actionId}`);
  if (!expected || expected.length !== token.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(token))) throw new Error("This iPhone did not claim the action.");
  if (action.status === "executed" || action.status === "failed") return false;
  if (action.status !== "approved") throw new Error("This action was not claimed.");
  if (Array.isArray(result.connections)) {
    const connections = normalizeAppleConnections({ availability: "available", connections: result.connections });
    if (connections.availability === "available") await store.updateRunMetadata(runId, { appleConnections: connections });
  }
  const ok = result.ok === true;
  const receipt = { ...result, $toolError: !ok, source: "iphone", receivedAt: new Date().toISOString() };
  const message = appleResultMessage(actionId, action.input.operation, receipt);
  const stored = { ...receipt } as Record<string, unknown>;
  if (typeof stored.imageBase64 === "string") { delete stored.imageBase64; stored.imageAttached = true; }
  return store.completeDeviceAction(actionId, runId, ok ? "executed" : "failed", stored, message);
}
