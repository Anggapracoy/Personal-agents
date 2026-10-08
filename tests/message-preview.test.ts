import test from 'node:test';
import assert from 'node:assert/strict';
import { messagePreview } from '../lib/message-preview';
import { sendProgress } from '../app/message-send-motion';

test('Home removes Markdown formatting without deleting literal punctuation', () => {
  assert.equal(messagePreview('you can **accept** it, or ***submit evidence***'), 'you can accept it, or submit evidence');
  assert.equal(messagePreview('Read [the guide](https://example.com) and _reply_.'), 'Read the guide and reply.');
  assert.equal(messagePreview('2 * 3 = 6 and `*.csv`'), '2 * 3 = 6 and *.csv');
  assert.equal(messagePreview('\\*literal stars\\*'), '*literal stars*');
  assert.equal(messagePreview('## Title\n\n- one\n- two'), 'Title one two');
});
test('send lift settles in 550ms without vertical overshoot and clamps elapsed time', () => {
  assert.equal(sendProgress(-1), 0);
  assert.equal(sendProgress(0), 0);
  assert.equal(sendProgress(550), 1);
  assert.equal(sendProgress(10_000), 1);
  let prior = 0;
  for (let time = 0; time <= 550; time += 8) {
    const progress = sendProgress(time);
    assert.ok(progress >= prior && progress <= 1);
    prior = progress;
  }
});
