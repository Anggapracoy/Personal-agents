import { newTurnActivityMetadata } from "./tool-activity-state";
import type { ModelMessage } from "ai";
import type { AgentRun } from "./types";

export type NotificationReplyInput = {
  owner: string;
  eventId: string;
  text: string;
  runId?: string;
  decisionId?: string;
  /** Only server-resolved, owned decision context may create a conversation. */
  newRun?: Pick<AgentRun, "category" | "request" | "title" | "metadata">;
};

export type NotificationReplyResult = {
  run: AgentRun;
  mode: "started" | "steering" | "duplicate";
};

export function notificationReplyId(message: ModelMessage): string | undefined {
  const value = message.providerOptions?.wdyt?.notificationReplyId;
  return typeof value === "string" ? value : undefined;
}

export function notificationReplyMessage(input: NotificationReplyInput): ModelMessage {
  return { role: "user", content: input.text, providerOptions: { wdyt: { notificationReplyId: input.eventId } } };
}

export function notificationReplyMetadata(run: AgentRun) {
  const metadata: Record<string, unknown> = { ...run.metadata, ...newTurnActivityMetadata, reactionResumeStatus: null, modelNotFoundRetries: 0, modelRetryAt: null };
  delete metadata.automaticPause;
  delete metadata.pauseDispatchId;
  return metadata;
}

export function previousResultMessage(run: AgentRun): ModelMessage[] {
  return run.result ? [{ role: "user", content: `[runtime] Previous task result, retained only as context. Do not repeat this as a new reply.\n${JSON.stringify(run.result)}` }] : [];
}
