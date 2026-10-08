import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarApprovalPreview, readableCalendarApproval } from '../lib/calendar-approval-preview';
test('calendar approval displays full local event details and converts old JSON receipts', () => {
  const event = { summary: 'Demo', start: { dateTime: '2026-09-25T15:00:00-04:00', timeZone: 'America/Toronto' }, end: { dateTime: '2026-09-25T15:15:00-04:00', timeZone: 'America/Toronto' }, attendees: [], location: '' };
  const preview = calendarApprovalPreview('Create Calendar event', event);
  assert.match(preview, /3:00 PM/); assert.match(preview, /3:15 PM/); assert.match(preview, /America\/Toronto/); assert.match(preview, /No guests/);
  assert.doesNotMatch(preview, /dateTime|\{/);
  assert.equal(readableCalendarApproval(`Create Calendar event\n${JSON.stringify(event)}`), preview);
  assert.equal(readableCalendarApproval('Other action\nunchanged'), 'Other action\nunchanged');
});
