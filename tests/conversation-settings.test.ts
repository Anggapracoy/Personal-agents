import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConversationAction, conversationActionSchema, conversationKey } from '../lib/conversation-settings';
import { conversationItems } from '../app/conversations';
import type { Decision, HistoryEntry, RunningTask } from '../lib/types';

test('pin, rename, archive and restore preserve independent settings and reject a tenth pin', () => {
  let settings = applyConversationAction({}, { key: 'decision:one', action: 'rename', title: 'My trip' });
  settings = applyConversationAction(settings, { key: 'decision:one', action: 'pin' }, '2026-09-07T00:00:00Z');
  assert.equal(settings['decision:one'].title, 'My trip');
  settings = applyConversationAction(settings, { key: 'decision:one', action: 'archive' });
  assert.equal(settings['decision:one'].pinnedAt, null); assert.equal(settings['decision:one'].archived, true);
  settings = applyConversationAction(settings, { key: 'decision:one', action: 'unarchive' });
  assert.equal(settings['decision:one'].title, 'My trip'); assert.equal(settings['decision:one'].archived, false);
  for (let n = 0; n < 9; n++) settings = applyConversationAction(settings, { key: `decision:${n}`, action: 'pin' });
  assert.throws(() => applyConversationAction(settings, { key: 'decision:tenth', action: 'pin' }), /up to 9/);
  settings = applyConversationAction(settings, { key: 'decision:0', action: 'unpin' });
  assert.ok(applyConversationAction(settings, { key: 'decision:tenth', action: 'pin' })['decision:tenth'].pinnedAt);
  assert.equal(conversationActionSchema.safeParse({ key: 'x', action: 'rename', title: '   ' }).success, false);
  assert.equal(conversationActionSchema.safeParse({ key: 'x', action: 'rename', title: 'x'.repeat(121) }).success, false);
});

test('conversation settings survive decision to active task to completed receipt identity changes', () => {
  const decision = { id: 'trip', title: 'Agent generated title', subtitle: 'Original request', category: 'travel', createdAt: '2026-09-07T00:00:00Z' } as Decision;
  const task = { id: 'running-row', decisionId: 'trip', runId: 'run', title: 'A later generated title', category: 'travel', subtitle: 'Running', status: 'running', updatedAt: '2026-09-07T01:00:00Z' } as RunningTask;
  const entry = { id: 'receipt-row', decisionId: 'trip', runId: 'run', title: 'New generated title', category: 'travel', subtitle: 'Done', completedAt: '2026-09-07T02:00:00Z' } as HistoryEntry;
  const key = conversationKey('trip');
  const settings = { [key]: { title: 'My trip', pinnedAt: '2026-09-07T00:01:00Z', archived: true } };
  for (const rows of [conversationItems([decision], [], [], undefined, settings), conversationItems([decision], [task], [], undefined, settings), conversationItems([], [], [entry], undefined, settings)]) {
    assert.equal(rows.length, 1); assert.equal(rows[0].key, key); assert.equal(rows[0].title, 'My trip'); assert.equal(rows[0].archived, true);
  }
  assert.equal(decision.title, 'Agent generated title', 'Renaming does not rewrite the original request');
});


test('unread is independent of attention, clears through the viewed reply, and returns for a newer reply', () => {
  const task = { id: 'row', decisionId: 'chat', runId: 'run', title: 'Dinner', category: 'social', subtitle: 'Internal status', status: 'needs_approval', updatedAt: '2026-08-24T13:00:00Z' } as RunningTask;
  const messages = { 'decision:chat': { text: 'Alex can do Thursday. Should I book?', createdAt: '2026-08-24T12:00:00Z' } };
  const rows = (settings = {}) => conversationItems([], [task], [], undefined, settings, messages);
  assert.equal(rows()[0].line, messages['decision:chat'].text);
  assert.equal(rows()[0].unread, true);
  const read = applyConversationAction({}, { key: 'decision:chat', action: 'read', through: messages['decision:chat'].createdAt });
  assert.equal(rows(read)[0].unread, false);
  assert.equal(rows(read)[0].state, 'need', 'Reading does not answer an approval');
  task.updatedAt = '2026-08-24T15:00:00Z';
  assert.equal(rows(read)[0].unread, false, 'Background activity does not create unread text');
  messages['decision:chat'] = { text: 'Alex sent another reply.', createdAt: '2026-08-24T14:00:00Z' };
  assert.equal(rows(read)[0].unread, true);
  const olderRead = applyConversationAction(read, { key: 'decision:chat', action: 'read', through: '2026-08-24T11:00:00Z' });
  assert.equal(olderRead['decision:chat'].lastReadAt, read['decision:chat'].lastReadAt);
});


test('manual unread survives settings changes, then reading clears it without hiding newer messages', () => {
  const key = 'decision:chat';
  const decision = { id: 'chat', title: 'Hello', subtitle: 'Hello', sourceType: 'manual', category: 'social', createdAt: '2026-08-24T12:00:00Z' } as Decision;
  const through = '2026-08-24T13:00:00Z';
  let settings = applyConversationAction({}, { key, action: 'read', through });
  settings = applyConversationAction(settings, conversationActionSchema.parse({ key, action: 'unread' }));
  assert.equal(settings[key].lastReadAt, new Date(through).toISOString());
  settings = applyConversationAction(settings, { key, action: 'rename', title: 'New title' });
  assert.equal(conversationItems([decision], [], [], undefined, settings)[0].unread, true);
  settings = applyConversationAction(settings, { key, action: 'read', through });
  assert.equal(conversationItems([decision], [], [], undefined, settings)[0].unread, false);
  assert.equal(conversationItems([decision], [], [], undefined, settings, { [key]: { text: 'New reply', createdAt: '2026-08-24T14:00:00Z' } })[0].unread, true);
});


test('a later run completion cannot replace the latest real reply with a synthetic receipt', () => {
  const entry = { id: 'receipt', decisionId: 'stripe', runId: 'run', title: 'Stripe', category: 'money', chosenOption: 'I guess accept it lol', status: 'failed', outcome: 'Done.', result: { summary: 'Done.' }, completedAt: '2026-09-07T23:36:18.364Z' } as HistoryEntry;
  const key = conversationKey('stripe');
  const message = { text: 'accepting means you’re letting the dispute stand', createdAt: '2026-09-07T23:36:14.558Z', unreadCount: 1 };
  const settings = { [key]: { lastReadAt: message.createdAt } };
  const row = conversationItems([], [], [entry], Date.parse('2026-09-07T23:37:00Z'), settings, { [key]: message })[0];
  assert.equal(row.line, message.text);
  assert.equal(row.messageAt, message.createdAt);
  assert.equal(row.unread, false, 'Finishing after the viewed reply is not another message');
  assert.ok(row.preview?.some(item => item.text === message.text));
  assert.ok(!row.preview?.some(item => item.text === 'Done.'));
  const loading = conversationItems([], [], [entry])[0];
  assert.equal(loading.line, '');
  assert.equal(loading.unread, false);
  assert.equal(conversationItems([], [], [entry], undefined, {}, { [key]: { ...message, text: 'Done.' } })[0].line, 'Done.', 'A real message is preserved verbatim, not filtered by wording');
});
