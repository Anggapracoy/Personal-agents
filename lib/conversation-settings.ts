import { z } from 'zod';
import { CHARACTERS } from './conversation-character';
import type { WorkspaceStateData } from './types';

export const conversationAvatarSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('character'), index: z.number().int().min(0).max(CHARACTERS.length - 1) }),
  z.object({ type: z.literal('emoji'), value: z.string().trim().min(1).max(32).refine(value => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length === 1 && /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value), 'Choose an emoji.') }),
  z.object({ type: z.literal('photo'), value: z.string().max(90000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/) }),
]);
export type ConversationAvatar = z.infer<typeof conversationAvatarSchema>;
export type ConversationSetting = { checklistItems?: Record<string, boolean>; avatar?: ConversationAvatar; lastReadAt?: string; markedUnread?: boolean; title?: string; pinnedAt?: string | null; archived?: boolean };
export type ConversationSettings = Record<string, ConversationSetting>;
export const conversationActionSchema = z.discriminatedUnion('action', [
  z.object({ key: z.string().min(1).max(600), action: z.literal('checklist'), itemKey: z.string().min(1).max(8192), checked: z.boolean() }),
  z.object({ key: z.string().min(1).max(600), action: z.literal('identity'), title: z.string().trim().min(1).max(120), avatar: conversationAvatarSchema.nullable() }),
  z.object({ key: z.string().min(1).max(600), action: z.literal('resetIdentity') }),
  z.object({ key: z.string().min(1).max(600), action: z.literal('read'), through: z.string().datetime() }),
  z.object({ key: z.string().min(1).max(600), action: z.literal('rename'), title: z.string().trim().min(1).max(120) }),
  z.object({ key: z.string().min(1).max(600), action: z.enum(['unread', 'pin', 'unpin', 'archive', 'unarchive']) }),
]);
export type ConversationAction = z.infer<typeof conversationActionSchema>;
export const MAX_PINNED_CONVERSATIONS = 9;
export const conversationKey = (decisionId?: string, runId?: string, entryId?: string) => decisionId ? `decision:${decisionId}` : runId ? `run:${runId}` : `entry:${entryId}`;
export function workspaceConversationKeys(state: WorkspaceStateData) {
  return new Set([
    ...state.decisions.map(item => conversationKey(item.id, item.activeRunId)),
    ...state.tasks.map(item => conversationKey(item.decisionId, item.runId, item.id)),
    ...state.history.map(item => conversationKey(item.decisionId, item.runId, item.id)),
  ]);
}
export function applyConversationAction(settings: ConversationSettings, action: ConversationAction, now = new Date().toISOString()): ConversationSettings {
  const current = Object.hasOwn(settings, action.key) ? settings[action.key] : {};
  if (action.action === 'pin' && !current.pinnedAt && Object.values(settings).filter(item => item.pinnedAt && !item.archived).length >= MAX_PINNED_CONVERSATIONS) throw new Error('You can pin up to 9 conversations. Unpin one first.');
  if (action.action === 'checklist') {
    const items = current.checklistItems ?? {};
    if (!Object.hasOwn(items, action.itemKey) && Object.keys(items).length >= 1000) throw new Error('This conversation has reached its saved checklist limit.');
    return { ...settings, [action.key]: { ...current, checklistItems: { ...items, [action.itemKey]: action.checked } } };
  }
  if (action.action === 'resetIdentity') {
    const { title: _title, avatar: _avatar, ...rest } = current;
    return { ...settings, [action.key]: rest };
  }
  if (action.action === 'identity') {
    const { avatar: _avatar, ...rest } = current;
    return { ...settings, [action.key]: { ...rest, title: action.title, ...(action.avatar ? { avatar: action.avatar } : {}) } };
  }
  const change: ConversationSetting = action.action === 'read' ? { markedUnread: false, lastReadAt: new Date(Math.max(Date.parse(current.lastReadAt || '1970-01-01'), Math.min(Date.parse(action.through), Date.parse(now)))).toISOString() } : action.action === 'unread' ? { markedUnread: true } : action.action === 'rename' ? { title: action.title.trim() }
    : action.action === 'pin' ? { pinnedAt: current.pinnedAt || now, archived: false }
    : action.action === 'unpin' ? { pinnedAt: null }
    : action.action === 'archive' ? { archived: true, pinnedAt: null } : { archived: false };
  return { ...settings, [action.key]: { ...current, ...change } };
}

export type ConversationMessage = { reaction?: boolean; kind?: 'user' | 'agent'; text: string; createdAt: string; incomingAt?: string; unreadCount?: number };
export type ConversationMessages = Record<string, ConversationMessage>;
