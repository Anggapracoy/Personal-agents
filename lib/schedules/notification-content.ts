/** A silent/empty scheduled result must never be turned into a completion alert. */
export function scheduledNotificationBody(input: {
  failed: boolean;
  error?: string | null;
  disposition?: unknown;
  checkSummary?: string | null;
  resultSummary?: string | null;
  response?: string | null;
}) {
  if (input.failed) return input.error?.trim() || 'I couldn’t complete the scheduled check. Please try again.';
  if (input.disposition === 'silent' || input.disposition === 'reaction') return '';
  return [input.checkSummary, input.resultSummary, input.response].find(value => value?.trim())?.trim() ?? '';
}

/** Retire canned completion alerts already queued by older workers. */
export function isGenericCompletionNotification(decisionId: string, body: string) {
  return decisionId.startsWith('run-completed:') && [
    'the scheduled task finished.',
    'dash finished the task successfully.',
  ].includes(body.trim().toLowerCase());
}
