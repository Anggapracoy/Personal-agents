type CalendarPreviewEvent = { summary?: string; description?: string; location?: string; start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string }; attendees?: { email?: string }[]; selfResponseStatus?: string };
export function calendarApprovalPreview(title: string, event: CalendarPreviewEvent): string {
  const time = (value: CalendarPreviewEvent['start']) => {
    if (!value?.dateTime) return '';
    try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: value.timeZone ?? 'UTC' }).format(new Date(value.dateTime)) + ` (${value.timeZone ?? 'UTC'})`; }
    catch { return value.dateTime; }
  };
  return [title, event.summary, event.start && `Starts: ${time(event.start)}`, event.end && `Ends: ${time(event.end)}`, event.location !== undefined && `Location: ${event.location || 'None'}`, event.attendees && `Guests: ${event.attendees.map(person => person.email).filter(Boolean).join(', ') || 'No guests'}`, event.selfResponseStatus && `Invitation response: ${event.selfResponseStatus}`, event.description && `Notes: ${event.description}`].filter(Boolean).join('\n');
}
/** Old saved approvals used raw JSON; display them without changing approved arguments. */
export function readableCalendarApproval(preview: string): string {
  if (!/^(Create|Update) Calendar event\b/.test(preview)) return preview;
  const newline = preview.indexOf('\n');
  if (newline < 0 || !preview.slice(newline + 1).trimStart().startsWith('{')) return preview;
  try { return calendarApprovalPreview(preview.startsWith('Create') ? 'Create Calendar event' : 'Update Calendar event', JSON.parse(preview.slice(newline + 1))); }
  catch { return preview; }
}
