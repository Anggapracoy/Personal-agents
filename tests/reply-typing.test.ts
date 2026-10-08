import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceReplyTyping } from '../lib/harness/reply-typing';

test('typing stays quiet during reading, reasoning, tools, and commentary', () => {
  for (const event of ['response.in_progress', 'reasoning-start', 'reasoning-delta', 'tool-input-start', 'tool-call', 'text-start']) assert.equal(advanceReplyTyping(false, event, undefined, false), false);
  assert.equal(advanceReplyTyping(false, 'text-delta', 'commentary', true), false);
  assert.equal(advanceReplyTyping(false, 'text-delta', undefined, false), false);
});
test('final text starts typing and remains until persistence or a tool boundary', () => {
  assert.equal(advanceReplyTyping(false, 'text-delta', 'final_answer', false), true);
  assert.equal(advanceReplyTyping(false, 'text-delta', undefined, true), true);
  for (const event of ['text-end', 'finish-step', 'finish']) assert.equal(advanceReplyTyping(true, event, 'final_answer', true), true);
  for (const event of ['start-step', 'tool-input-start', 'tool-call', 'reasoning-start']) assert.equal(advanceReplyTyping(true, event, 'final_answer', true), false);
});
