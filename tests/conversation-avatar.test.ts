import assert from 'node:assert/strict';
import test from 'node:test';
import { characterIndexFor, newManualConversationId } from '../lib/conversation-character';
import { conversationKey } from '../lib/conversation-settings';

test('conversation avatars keep their assignment across reloads and releases', () => {
  assert.deepEqual(['decision:message-123', 'decision:flight-1', 'run:legacy-42', 'entry:dismissed-7'].map(characterIndexFor), [5, 5, 4, 4]);
});

test('starting, running, completing and retrying a decision retain its character', () => {
  const keys = [
    conversationKey('message-123'),
    conversationKey('message-123', 'first-run'),
    conversationKey('message-123', 'first-run', 'completed-entry'),
    conversationKey('message-123', 'retry-run', 'completed-entry'),
  ];
  assert.equal(new Set(keys.map(characterIndexFor)).size, 1);
  assert.equal(new Set(Array.from({ length: 100 }, (_, i) => characterIndexFor(conversationKey(`message-${i}`)))).size, 6);
});

test('a new manual chat avoids the previous character without changing its stable assignment', () => {
  const randomId = 'fb09bb0c-2b7e-4da5-8cb7-590987b148fa';
  const first = newManualConversationId(undefined, randomId);
  const previousKey = Array.from({ length: 100 }, (_, index) => conversationKey(`older-${index}`))
    .find(key => characterIndexFor(key) === characterIndexFor(conversationKey(first)));
  assert.ok(previousKey);
  const next = newManualConversationId(previousKey, randomId);
  assert.notEqual(characterIndexFor(conversationKey(next)), characterIndexFor(previousKey));
  assert.equal(newManualConversationId(previousKey, randomId), next);
  const differentPrevious = Array.from({ length: 100 }, (_, index) => conversationKey(`other-${index}`))
    .find(key => characterIndexFor(key) !== characterIndexFor(conversationKey(first)));
  assert.ok(differentPrevious);
  assert.equal(newManualConversationId(differentPrevious, randomId), first);
});
