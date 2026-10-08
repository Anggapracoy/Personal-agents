import { blockMessageSchema } from "./result-schema";
import { includeWaitSummaries, type WaitSummary } from "./wait-summary";
import type { PauseDisplay } from "../pauses/definition";
import { ACTIVITY_ICONS, activityIcon, type ActivityIconName, type ToolActivity } from "./tool-activity-icons";
import { activityLabel } from "./tool-activity-labels";
import { userFiles, type MessageFile } from "./user-files";
import { userPhotos, type MessagePhoto } from "./user-photos";
import { includeCallSummaries, type CallSummary } from "./call-summary";
import { questionSummary, includeAnsweredQuestions, type AnswerSummary } from "./question-summary";
import { messageReactionSchema, reactionOf, isReactionEmoji, replyContextOf, type ReplyContext, type MessageReaction } from "./reactions";
import { pendingSteering } from "./steering";
import { readMessageReceipt } from "./message-receipt";
import { photoMessageSchema, photoMimeTypes, videoMessageSchema, fileMessageSchema } from "./attachments";
import { videoMimeForArtifact } from "./video-format";
import type { AgentMessage, AgentRunSnapshot } from "./types";

export type ThreadItem =
  | WaitSummary
  | CallSummary
  | AnswerSummary
  | { id: string; kind: "user"; photos?: MessagePhoto[]; files?: MessageFile[]; localFiles?: File[]; reactions?: MessageReaction[]; replyTo?: ReplyContext; text: string; createdAt?: string; deliveryState?: "sending" | "failed"; deliveredAt?: string; readAt?: string }
  | { id: string; kind: "agent"; results?: import("../message-results").MessageResult[]; reactions?: MessageReaction[]; replyTo?: ReplyContext; text: string; createdAt?: string; photos?: Array<{ id: string; url: string; description: string }>; photoCaption?: string; videos?: Array<{ id: string; url: string; name: string; description: string }>; videoCaption?: string; files?: Array<{ id: string; url: string; name: string; mimeType: string; description: string }>; fileCaption?: string }
  | { id: string; kind: "activity"; tool: string; label: string; browserFrameId?: string }
  | { id: string; kind: "options"; options: NonNullable<AgentRunSnapshot["result"]>["options"] }
  | { id: string; kind: "blocks"; createdAt?: string; blocks: NonNullable<AgentRunSnapshot["result"]>["blocks"]; followUpActions: NonNullable<AgentRunSnapshot["result"]>["followUpActions"] };

// Historical tool names stay hidden when rendering already-saved conversations.
const HIDDEN_TOOLS = new Set(["present_result", "show_options", "report_check", "schedule_list", "gmail_send_draft", "send_attachments", "send_photos", "send_videos", "send_files", "finish_without_reply", "react_to_message", "confetti", "easteregg"]);
/** Keep the latest tool label between calls; Thinking is only the pre-tool state. */
export function conversationWorkActivity(snapshot: AgentRunSnapshot): ToolActivity | null {
  if (!["running", "planning"].includes(snapshot.status)) return null;
  if (Array.isArray(snapshot.metadata.pendingSteering) && snapshot.metadata.pendingSteering.length) return { label: "Thinking", icon: "thinking" };
  if (snapshot.metadata.replyTyping === true) return { label: "Typing", icon: "typing" };
  const activity = snapshot.metadata.toolActivity as { label?: unknown; icon?: unknown } | null | undefined;
  const action = snapshot.actions.find(action => action.id === snapshot.metadata.currentActivityActionId);
  // Answered questions are no longer work in progress. Keep a working status
  // during the model's next step rather than retaining the question tool label.
  if (action?.toolName === "ask_questions" && action.status === "executed") return { label: "Planning next moves", icon: "thinking" };
  if (typeof activity?.label === "string") return { label: activity.label,
    icon: typeof activity.icon === "string" && Object.hasOwn(ACTIVITY_ICONS, activity.icon) ? activity.icon as ActivityIconName
      : action ? activityIcon(action.toolName, action.input) : "thinking" };
  return action ? { label: activityLabel(action.toolName, action.input), icon: activityIcon(action.toolName, action.input) }
    : { label: "Thinking", icon: "thinking" };
}

/** Actual tool starts affect feed order; heartbeats and completion bookkeeping do not. */
export function conversationActivityAt(snapshot: AgentRunSnapshot): string | undefined {
  const activity = snapshot.metadata.toolActivity as { startedAt?: unknown } | null;
  const candidates = [snapshot.metadata.toolActivityAt,
    typeof activity?.startedAt === "number" && Number.isFinite(new Date(activity.startedAt).getTime()) ? new Date(activity.startedAt).toISOString() : undefined,
    ...snapshot.actions.map(action => action.createdAt ?? action.executedAt)];
  const latest = Math.max(0, ...candidates.map(value => typeof value === "string" ? Date.parse(value) || 0 : 0));
  return latest ? new Date(latest).toISOString() : undefined;
}

export function conversationWorkLabel(snapshot: AgentRunSnapshot) {
  const activity = conversationWorkActivity(snapshot);
  if (activity?.icon === "typing") return null;
  return activity?.label === "Thinking" && snapshot.metadata.taskWorkStarted !== true && !snapshot.metadata.toolActivity && !snapshot.metadata.currentActivityActionId ? null : activity?.label ?? null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part): part is { type: "text"; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text").map((part) => part.text).join("");
}

/** Collapse raw ModelMessages into what a person should see. Runtime notes and tool payloads never render verbatim. */
export function threadItems(snapshot: AgentRunSnapshot, messages: AgentMessage[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  const receipt = readMessageReceipt(snapshot.metadata.messageReceipt);
  const previous = snapshot.metadata.previousConversation;
  if (Array.isArray(previous)) for (const [index, message] of previous.entries()) {
    if (message && typeof message.text === "string" && (message.role === "user" || message.role === "assistant")) items.push({ id: `${snapshot.id}:previous:${index}`, kind: message.role === "user" ? "user" : "agent", text: message.text, reactions: Array.isArray(message.reactions) ? message.reactions.slice(0, 2).flatMap((reaction: unknown) => { const parsed = messageReactionSchema.safeParse(reaction); return parsed.success ? [parsed.data] : []; }) : undefined });
  }
  const origin = snapshot.metadata.retryDecision as { title?: string; subtitle?: string; createdAt?: unknown; options?: Array<{id:string;label:string}> } | undefined;
  // The suggestion predates the run created by the first reply. Preserve that
  // original instant across optimistic rendering, persisted history and reloads.
  const openingCreatedAt = typeof origin?.createdAt === "string" && Number.isFinite(Date.parse(origin.createdAt))
    ? origin.createdAt : snapshot.createdAt;
  if (!previous && snapshot.metadata.sourceType && (snapshot.metadata.sourceType !== "manual" || Boolean(snapshot.metadata.starterKey) || Boolean((snapshot.metadata.executionContext as { sharedIntake?: unknown } | undefined)?.sharedIntake)) && origin?.subtitle) items.push({ id: `${snapshot.id}:opening`, kind: "agent", createdAt: openingCreatedAt, text: origin.subtitle, ...(typeof snapshot.metadata.initialReaction === "string" && isReactionEmoji(snapshot.metadata.initialReaction) ? { reactions: [{ actor: "user", emoji: snapshot.metadata.initialReaction, createdAt: snapshot.createdAt }] } : {}) });
  const choiceOptions = Array.isArray(origin?.options) ? origin.options.filter(option=>option && typeof option.label === "string") : [];
  const selectedChoice = typeof snapshot.metadata.sourceType === "string" && snapshot.metadata.sourceType !== "manual" && !snapshot.metadata.customInstruction && !snapshot.metadata.userMessage && !snapshot.metadata.initialReaction && choiceOptions.find(option=>option.label===snapshot.metadata.chosenOption);
  if(selectedChoice) items.push({id:`${snapshot.id}:choice`,kind:"answers",createdAt:snapshot.createdAt,answers:[{question:"What would you like to do?",answer:selectedChoice.label,choice:true,selectedOptions:[{label:selectedChoice.label}]}]});
  const frameByActionInput = new Map<string, string>();
  for (const artifact of snapshot.artifacts) if (artifact.actionId && artifact.name.startsWith("browser-frame-")) frameByActionInput.set(artifact.actionId, artifact.id);
  const actionsByTool = new Map<string, string[]>();
  for (const action of snapshot.actions) { const list = actionsByTool.get(action.toolName) ?? []; list.push(action.id); actionsByTool.set(action.toolName, list); }
  const usedActionIds = new Set<string>();
  // Older reply handling inserted summary/details again after the final text.
  // Recognize that exact generated receipt, never fuzzy-match user-facing prose.
  const legacyReceipts = new Set<string>();
  for (const row of messages) if (row.message.role === "assistant" && Array.isArray(row.message.content)) {
    for (const part of row.message.content) if (part.type === "tool-call" && part.toolName === "present_result") {
      const result = part.input as { summary?: unknown; details?: unknown; links?: { label: string; url: string }[] };
      if (typeof result?.summary === "string" && typeof result.details === "string" && Array.isArray(result.links)) {
        legacyReceipts.add([result.summary, result.details !== result.summary ? result.details : "", ...result.links.map(link => `${link.label}: ${link.url}`)].filter(Boolean).join("\n\n"));
      }
    }
  }

  for (const [index, item] of messages.entries()) {
    const message = item.message;
    if (reactionOf(message)) continue;
    if (message.role === "user") {
      if(index===0 && selectedChoice) continue;
      const text = textOf(Array.isArray(message.content) ? message.content.filter(part => part.type !== "text" || !part.text.startsWith("[attachment context]") && !part.text.startsWith("[reply context]")) : message.content);
      if (text.startsWith("[runtime]")) continue;
      // The seeded first turn carries trusted context after the request; show only the request.
      const visible = index === 0 ? (snapshot.metadata.userMessage as string | undefined) ?? (snapshot.metadata.customInstruction as string | undefined) ?? (snapshot.metadata.chosenOption as string | undefined) ?? snapshot.request : text;
      const photos = userPhotos(snapshot, index === 0 ? undefined : message);
      const files = userFiles(snapshot, index === 0 ? undefined : message);
      if (visible.trim() || photos.length || files.length) items.push({ id: item.id, kind: "user", ...(photos.length ? { photos } : {}), ...(files.length ? { files } : {}), ...(replyContextOf(message) ? { replyTo: replyContextOf(message) } : {}), createdAt: index === 0 ? snapshot.createdAt : item.createdAt, text: visible.trim(), ...(receipt?.messageId === item.id ? { deliveredAt: receipt.deliveredAt, readAt: receipt.readAt } : {}) });
      continue;
    }
    if (message.role !== "assistant") continue;
    const blockMessage = blockMessageSchema.safeParse(message.providerOptions?.wdyt?.blockMessage);
    if (blockMessage.success) {
      items.push({ id: item.id, kind: "blocks", createdAt: item.createdAt, ...blockMessage.data });
      continue;
    }
    const fileMessage = fileMessageSchema.safeParse(message.providerOptions?.wdyt?.fileMessage);
    if (fileMessage.success) {
      const files = fileMessage.data.files.flatMap(file => {
        const artifact = snapshot.artifacts.find(artifact => artifact.id === file.artifactId);
        return artifact ? [{ id: artifact.id, url: `/api/runs/${snapshot.id}/artifacts/${artifact.id}`, name: artifact.name, mimeType: artifact.mimeType, description: file.description }] : [];
      });
      if (files.length) {
        items.push({ id: item.id, kind: "agent", text: fileMessage.data.caption || (files.length === 1 ? files[0].name : `${files.length} files`), createdAt: item.createdAt, files, fileCaption: fileMessage.data.caption });
        continue;
      }
    }
    const videoMessage = videoMessageSchema.safeParse(message.providerOptions?.wdyt?.videoMessage);
    if (videoMessage.success) {
      const videos = videoMessage.data.videos.flatMap(video => {
        const artifact = snapshot.artifacts.find(artifact => artifact.id === video.artifactId && videoMimeForArtifact(artifact));
        return artifact ? [{ id: artifact.id, url: `/api/runs/${snapshot.id}/artifacts/${artifact.id}`, name: artifact.name, description: video.description }] : [];
      });
      if (videos.length) {
        items.push({ id: item.id, kind: "agent", text: videoMessage.data.caption || (videos.length === 1 ? "Video" : `${videos.length} videos`), createdAt: item.createdAt, videos, videoCaption: videoMessage.data.caption });
        continue;
      }
    }
    const photoMessage = photoMessageSchema.safeParse(message.providerOptions?.wdyt?.photoMessage);
    if (photoMessage.success) {
      const photos = photoMessage.data.photos.flatMap(photo => {
        const artifact = snapshot.artifacts.find(artifact => artifact.id === photo.artifactId && photoMimeTypes.has(artifact.mimeType));
        return artifact ? [{ id: artifact.id, url: `/api/runs/${snapshot.id}/artifacts/${artifact.id}`, description: photo.description }] : [];
      });
      if (photos.length) {
        items.push({ id: item.id, kind: "agent", text: photoMessage.data.caption || (photos.length === 1 ? "Photo" : `${photos.length} photos`), createdAt: item.createdAt, photos, photoCaption: photoMessage.data.caption });
        continue;
      }
    }
    const text = textOf(message.content);
    const preceding = messages[index - 1]?.message;
    const isLegacyReceipt = legacyReceipts.has(text) && preceding?.role === "assistant" && textOf(preceding.content).trim() && messages[index + 1]?.message.role === "user";
    if (text.trim() && !isLegacyReceipt) items.push({ id: item.id, kind: "agent", createdAt: item.createdAt, text: text.trim() });
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "tool-call" || HIDDEN_TOOLS.has(part.toolName)) continue;
      const input = (part.input ?? {}) as Record<string, unknown>;
      const label = activityLabel(part.toolName, input);
      const actionId = (actionsByTool.get(part.toolName) ?? []).find((id) => !usedActionIds.has(id));
      if (actionId) usedActionIds.add(actionId);
      const answers = actionId ? questionSummary(snapshot.actions.find(action => action.id === actionId)!) : null;
      if (answers) { items.push(answers); continue; }
      items.push({ id: `${item.id}:${part.toolCallId}`, kind: "activity", tool: part.toolName, label, browserFrameId: actionId ? frameByActionInput.get(actionId) : undefined });
    }
  }
  for (const pending of pendingSteering(snapshot)) {
    if (!reactionOf(pending.message) && !items.some(item => item.id === pending.id)) items.push({ id: pending.id, kind: "user", photos: userPhotos(snapshot, pending.message), files: userFiles(snapshot, pending.message), ...(replyContextOf(pending.message) ? { replyTo: replyContextOf(pending.message) } : {}), text: textOf(Array.isArray(pending.message.content) ? pending.message.content.filter(part => part.type !== "text" || !part.text.startsWith("[attachment context]") && !part.text.startsWith("[reply context]")) : pending.message.content), createdAt: pending.createdAt, deliveredAt: pending.createdAt });
  }
  if (!pendingSteering(snapshot).length && snapshot.result?.options?.length && !snapshot.result.blocks?.length) items.push({ id: `${snapshot.id}:options`, kind: "options", options: snapshot.result.options });
  if (!pendingSteering(snapshot).length && snapshot.result?.blocks?.length && !snapshot.result.blocksMessageId) items.push({ id: `${snapshot.id}:blocks`, kind: "blocks", blocks: snapshot.result.blocks, followUpActions: snapshot.result.followUpActions ?? [] });
  // Fold durable events, including input queued while the agent is working.
  for (const event of [...messages, ...pendingSteering(snapshot)]) {
    const reaction = reactionOf(event.message);
    if (!reaction) continue;
    const target = items.find(item => item.id === reaction.messageId);
    if (!target || (target.kind !== "agent" && target.kind !== "user")) continue;
    const actor = event.message.role === "user" ? "user" : "agent";
    target.reactions = (target.reactions ?? []).filter(item => item.actor !== actor);
    if (reaction.emoji) target.reactions.push({ actor, emoji: reaction.emoji, createdAt: event.createdAt });
  }
  return includeWaitSummaries(includeCallSummaries(includeAnsweredQuestions(items, snapshot.actions), snapshot.actions), snapshot.actions, snapshot.status === "paused" ? snapshot.metadata.automaticPause as PauseDisplay | undefined : undefined);
}

/** Keep a just-saved choice visible while the first message-log response catches up. */
export function retainSubmittedReply(received: ThreadItem[], cached: ThreadItem[]): ThreadItem[] {
  const submitted = cached.find(item => item.kind === "user" && item.id.endsWith(":submitted"));
  if (!submitted || submitted.kind !== "user") return received;
  if (received.some(item => item.kind === "user" && !item.id.includes(":previous:") && item.text === submitted.text)) return received;
  return [...received, submitted];
}

/** A text reply replaces the previous choices; retain the conversation itself. */
export function discardThreadOptions(items: ThreadItem[]): ThreadItem[] {
  return items.filter(item => item.kind !== "options");
}
