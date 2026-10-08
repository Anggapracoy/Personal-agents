import assert from 'node:assert/strict';
import test from 'node:test';
import { readConversationList, saveConversationList, updateConversationListSettings, clearConversationList, type ConversationListSnapshot } from '../app/conversation-list-cache';
import { conversationItems } from '../app/conversations';
import { applyConversationAction } from '../lib/conversation-settings';

test('reopening retains an archive before another render, and restore updates the same saved list', () => {
  const values = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    const snapshot: ConversationListSnapshot = { decisions: [{ id: 'trip', sourceType: 'manual', category: 'travel', urgency: 'medium', title: 'Trip', subtitle: 'Plan', originalContext: '', options: [], dismissLabel: 'Later', createdAt: '2026-09-05T10:00:00Z' }], tasks: [], history: [], settings: {}, messages: {} };
    saveConversationList('A@example.com', snapshot);
    const archived = applyConversationAction({}, { key: 'decision:trip', action: 'archive' });
    updateConversationListSettings('a@example.com', archived);
    const reopened = readConversationList('A@example.com')!;
    assert.equal(conversationItems(reopened.decisions, reopened.tasks, reopened.history, undefined, reopened.settings).filter(item => !item.archived).length, 0);
    assert.equal(readConversationList('other@example.com'), null);
    updateConversationListSettings('a@example.com', applyConversationAction(archived, { key: 'decision:trip', action: 'unarchive' }));
    assert.equal(readConversationList('a@example.com')!.settings['decision:trip'].archived, false);
    clearConversationList('a@example.com');
    updateConversationListSettings('a@example.com', archived);
    assert.equal(readConversationList('a@example.com'), null);
    values.set('wdyt-conversation-list-v1:a@example.com', '{broken');
    assert.equal(readConversationList('a@example.com'), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
