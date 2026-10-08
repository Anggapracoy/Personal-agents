import type { ConversationMessages, ConversationSettings } from '../lib/conversation-settings';
import type { Decision, HistoryEntry, RunningTask } from '../lib/types';

// Presentation only: never hydrate the writable workspace from this snapshot.
export type ConversationListSnapshot = {
  decisions: Decision[]; tasks: RunningTask[]; history: HistoryEntry[];
  settings: ConversationSettings; messages: ConversationMessages;
};
const key = (email: string) => `wdyt-conversation-list-v1:${email.toLowerCase()}`;
export function readConversationList(email: string): ConversationListSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(email)) ?? 'null');
    return value && Array.isArray(value.decisions) && Array.isArray(value.tasks) && Array.isArray(value.history)
      && value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings)
      && value.messages && typeof value.messages === 'object' && !Array.isArray(value.messages) ? value : null;
  } catch { return null; }
}
export function saveConversationList(email: string, snapshot: ConversationListSnapshot) {
  try { localStorage.setItem(key(email), JSON.stringify(snapshot)); } catch { /* Storage is optional. */ }
}
export function updateConversationListSettings(email: string, settings: ConversationSettings) {
  const saved = readConversationList(email);
  if (saved) saveConversationList(email, { ...saved, settings });
}
export function clearConversationList(email: string) {
  try { localStorage.removeItem(key(email)); } catch { /* Storage is optional. */ }
}
