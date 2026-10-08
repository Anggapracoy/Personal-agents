import { messagePreview } from '../lib/message-preview';
import { conversationKey, type ConversationMessages, type ConversationSettings } from "../lib/conversation-settings";
import type { Decision, HistoryEntry, RunningTask } from "../lib/types";
import type { HomeItem } from "./home";
import { iconKindFor } from "./task-icon";
import { conversationTimeLabel } from "./message-time";

/** One row per conversation, regardless of its origin or execution status. */
export function conversationItems(decisions: Decision[], tasks: RunningTask[], history: HistoryEntry[], now?: number, settings: ConversationSettings = {}, messages: ConversationMessages = {}): HomeItem[] {
  const rows = new Map<string, HomeItem & { updated: number }>();
  const stamp = (value?: string) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  for (const entry of history) {
    const key = entry.decisionId ?? entry.runId ?? entry.id;
    const updated = stamp(entry.completedAt);
    if (rows.has(key) && rows.get(key)!.updated >= updated) continue;
    rows.set(key, { id: entry.id, key: conversationKey(entry.decisionId, entry.runId, entry.id), title: entry.title, line: entry.runId ? "" : entry.choiceAcknowledgment ? "Reacted 👍" : entry.outcome || entry.subtitle, kind: iconKindFor(entry.category), messageAt: !entry.runId && entry.status !== "dismissed" && entry.responseDisposition !== "silent" && entry.responseDisposition !== "reaction" ? entry.completedAt : undefined, state: "watch", time: now && entry.completedAt ? conversationTimeLabel(entry.completedAt, now) : entry.time, updated });
  }
  for (const decision of decisions) {
    if (rows.has(decision.id)) continue;
    const option = decision.options?.find(option => option.isPrimary && option.actionType !== 'no_action') ?? decision.options?.find(option => option.actionType !== 'no_action');
    const alternative = decision.options?.find(candidate => candidate.id !== option?.id);
    const proactive = decision.sourceType !== 'manual' && !decision.activeRunId && !decision.result
      ? { personalized: decision.sourceType === 'proactive' && Boolean(decision.discoveryFingerprint?.startsWith('morning:')), context: decision.sourceLabel || 'For you', body: decision.subtitle, alternative: alternative ? { id: alternative.id, label: alternative.label } : undefined, option: option ? { id: option.id, label: option.label } : undefined } : undefined;
    rows.set(decision.id, { proactive, id: decision.id, key: conversationKey(decision.id, decision.activeRunId), title: decision.title, line: decision.result?.summary || decision.subtitle, kind: iconKindFor(decision.category), messageAt: decision.sourceType !== "manual" ? decision.createdAt : undefined, state: decision.activeRunId || decision.result ? "watch" : "need", time: now ? conversationTimeLabel(decision.createdAt, now) : undefined, updated: stamp(decision.createdAt) });
  }
  for (const task of tasks) {
    // Active execution replaces the previous receipt in the same conversation.
    if (task.runId) for (const [key, row] of rows) if (key === task.runId || row.id === task.runId) rows.delete(key);
    const questions = task.questionRequest?.questions ?? [];
    const question = task.status === "needs_approval" && task.actionId && questions.length === 1 && ["single_choice", "multiple_choice"].includes(questions[0].answerType) ? questions[0] : undefined;
    const feedQuestion = question ? { actionId: task.actionId!, questionId: question.id, multiple: question.answerType === "multiple_choice", moreOptions: question.options.length > 2 } : undefined;
    const proactive = question ? { context: "Needs your answer", body: question.question, option: question.options[0], alternative: question.options[1] } : undefined;
    rows.set(task.decisionId, { feedQuestion, proactive, id: task.id, key: conversationKey(task.decisionId, task.runId, task.id), title: task.title, line: task.subtitle, kind: iconKindFor(task.category), state: task.status === "needs_approval" ? "need" : "watch", time: now ? conversationTimeLabel(task.updatedAt, now) : undefined, updated: stamp(task.updatedAt) });
  }
  return [...rows.values()].map(row => {
    const setting = settings[row.key!] ?? {};
    const candidate = messages[row.key!];
    // A run finishes after its reply is saved. Completion time is not a newer message.
    const message = candidate;
    const messageAt = message?.incomingAt ?? (message?.kind === 'user' ? undefined : message?.createdAt ?? row.messageAt);
    const unread = !setting.archived && Boolean(setting.markedUnread || (messageAt && stamp(messageAt) > stamp(setting.lastReadAt) && candidate?.unreadCount !== 0));
    const task = tasks.find(item => item.id === row.id);
    const decision = decisions.find(item => item.id === row.id || item.id === task?.decisionId);
    const entry = history.find(item => item.id === row.id);
    const activityAt = task?.activityAt ?? entry?.activityAt;
    const latestAt = stamp(activityAt) > stamp(message?.createdAt) ? activityAt : message?.createdAt;
    const runId = task?.runId ?? decision?.activeRunId ?? entry?.runId;
    const request = task?.chosenOption ?? entry?.chosenOption;
    const preview: NonNullable<HomeItem['preview']> = [
      ...(request ? [{ kind: 'user' as const, text: request }] : []),
      { kind: message?.kind ?? (decision?.sourceType === 'manual' && !runId ? 'user' as const : 'agent' as const), text: message?.text ?? row.line },
    ].filter((item, index, all) => item.text && !(index > 0 && item.kind === all[index - 1].kind && item.text === all[index - 1].text));
    const phone = task?.automaticPause?.eventKind === 'phone_call' ? task.automaticPause.phoneCall : undefined;
    const pause = task?.status === 'waiting' ? task.automaticPause : undefined;
    const wake = pause?.wakeAt && Number.isFinite(Date.parse(pause.wakeAt))
      ? new Date(pause.wakeAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
    const waitingLabel = pause?.eventKind === 'gmail_reply' ? `Waiting for reply${wake ? ` · Checks ${wake}` : ''}`
      : pause?.eventKind === 'calendar_event_created' ? 'Waiting for calendar event'
      : wake ? `Waiting until ${wake}` : pause?.reason ? `Waiting · ${pause.reason}` : 'Waiting';
    const activity = pause && !phone ? { label: waitingLabel, icon: 'clock' as const }
      : message?.reaction || (message?.kind === 'agent' && stamp(message.createdAt) > stamp(activityAt) && Boolean(activityAt)) ? undefined : task?.status === 'running' ? task.activity ?? { label: 'Thinking', icon: 'thinking' as const }
      : task?.status === 'waiting' && phone && ['queued', 'ringing', 'in_progress'].includes(phone.status)
        ? { label: phone.status === 'in_progress' ? 'On the phone' : 'Calling', icon: 'phone' as const } : undefined;
    return { ...row, ...setting, runId, preview, activity, waiting: Boolean((pause && !phone)), title: setting.title || row.title,
      line: messagePreview(message?.text ?? row.line), messageAt,
      unreadCount: unread ? Math.max(1, candidate?.unreadCount ?? 1) : 0,
      unread,
      time: latestAt && now ? conversationTimeLabel(latestAt, now) : row.time,
      updated: latestAt ? stamp(latestAt) : row.updated };
  }).sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));
}
