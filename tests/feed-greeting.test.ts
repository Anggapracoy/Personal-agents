import assert from 'node:assert/strict';
import test from 'node:test';
import { feedGreetings, nextFeedGreeting } from '../lib/feed-greeting';

test('greetings respect local time boundaries and weekday', () => {
  for (const [hour, prefix] of [[4, 'A little late-night'], [5, 'Morning'], [11, 'Morning'], [12, 'Good afternoon'], [16, 'Good afternoon'], [17, 'Evening'], [21, 'Evening'], [22, 'A little late-night']] as const) {
    const values = feedGreetings(' Alex Example ', new Date(2026, 8, 24, hour));
    assert.ok(values[0].startsWith(prefix));
    assert.ok(values.includes('Happy Thursday, Alex'));
    assert.ok(values.every(value => !value.includes('Example')));
  }
});
test('rotation avoids immediate repeats and handles missing names', () => {
  const now = new Date(2026, 8, 24, 9);
  for (const previous of feedGreetings('Alex', now)) for (const random of [0, .3, .9, 1]) assert.notEqual(nextFeedGreeting('Alex', now, previous, random), previous);
  assert.ok(feedGreetings(null, now).includes('Hey there'));
  assert.ok(feedGreetings(' ', now).every(value => !value.endsWith(',')));
});
