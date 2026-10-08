import type { HistoryEntry } from "../lib/types";
import type { ThreadItem } from "../lib/harness/thread";

/** No-agent choices use the same persisted message reactions as ordinary chats. */
export function historyThreadItems(entry: HistoryEntry): ThreadItem[] {
  const option = entry.retryDecision?.sourceType !== "manual" ? entry.retryDecision?.options.find(option=>option.label===entry.chosenOption) : undefined;
  const choice: ThreadItem = option ? {id:`${entry.id}-user`,kind:"answers",createdAt:entry.completedAt,answers:[{question:"What would you like to do?",answer:option.label,choice:true,selectedOptions:[{label:option.label}]}]} : { id: `${entry.id}-user`, kind: "user", text: entry.chosenOption, ...(entry.choiceAcknowledgment ? {reactions:[{actor:"agent",emoji:entry.choiceAcknowledgment,createdAt:entry.completedAt??""}]} : {}) };
  const items: ThreadItem[] = [
    { id: `${entry.id}-context`, kind: "agent", text: entry.contextSummary || entry.subtitle },
    choice,
    ...((entry.result?.leadIn || entry.outcome) && !entry.result?.blocksOnly && entry.responseDisposition !== "reaction" && entry.responseDisposition !== "silent"
      ? [{ id: `${entry.id}-agent`, kind: "agent" as const, text: entry.result?.leadIn || entry.outcome }] : []),
    ...(entry.result?.blocks?.length ? [{ id: `${entry.id}-blocks`, kind: "blocks" as const, blocks: entry.result.blocks, followUpActions: entry.result.followUpActions ?? [] }] : []),
  ];
  return items.map(item => (item.kind === "user" || item.kind === "agent") ? {
    ...item, reactions: [...(item.reactions ?? []), ...(entry.messageReactions?.[item.id] ?? [])],
  } : item);
}
