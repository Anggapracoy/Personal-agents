import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduledNotificationBody, isGenericCompletionNotification } from '../lib/schedules/notification-content';

test('silent scheduled work never creates an alert even if old summary data exists', () => {
  for (const disposition of ['silent', 'reaction']) assert.equal(scheduledNotificationBody({ failed: false, disposition, response: '', resultSummary: 'Old result' }), '');
  assert.equal(scheduledNotificationBody({ failed: false, response: '' }), '');
  assert.equal(scheduledNotificationBody({ failed: false, response: '  ', resultSummary: '\n' }), '');
});
test('real scheduled results and actionable failures retain their content', () => {
  assert.equal(scheduledNotificationBody({ failed: false, checkSummary: 'Price dropped to $30.' }), 'Price dropped to $30.');
  assert.equal(scheduledNotificationBody({ failed: false, resultSummary: ' ', response: 'Your requested report is ready.' }), 'Your requested report is ready.');
  assert.equal(scheduledNotificationBody({ failed: true, disposition: 'silent', error: 'Reconnect your account.' }), 'Reconnect your account.');
});
test('legacy canned completion alerts are suppressed without filtering user reminders', () => {
  assert.equal(isGenericCompletionNotification('run-completed:run:occurrence', 'The scheduled task finished.'), true);
  assert.equal(isGenericCompletionNotification('run-completed:run', 'Dash finished the task successfully.'), true);
  assert.equal(isGenericCompletionNotification('run-completed:run', 'Your report is ready.'), false);
  assert.equal(isGenericCompletionNotification('decision:reminder', 'The scheduled task finished.'), false);
});
