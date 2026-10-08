import { inngest } from '../../harness/inngest-client';
import { requestLeaveNowChecks } from './detectors/leave-now';
import { cleanUpCards } from './detectors/hygiene';

export const leaveNowWorker = inngest.createFunction(
  { id: 'proactive-leave-now-checks', retries: 1, concurrency: 1, triggers: [{ cron: '*/5 * * * *' }] },
  async ({ step }) => step.run('request-travel-times', () => requestLeaveNowChecks()),
);

/** Durable one-off timer. Waking up only dispatches the same serialized Google
 * worker; no parallel follow-up checker can race that connection's updates. */
export const followUpTimerWorker = inngest.createFunction(
  { id: 'proactive-follow-up-timer', retries: 4, triggers: [{ event: 'decision-feed/proactive.follow-up.scheduled' }] },
  async ({ event, step }) => {
    await step.sleepUntil('wait-until-due', event.data.dueAt);
    await step.sendEvent('check-thread-once', {
      name: 'decision-feed/google.source.changed',
      data: { ownerEmail: event.data.ownerEmail, connectionId: event.data.connectionId, source: 'gmail', followUpThreadId: event.data.threadId, followUpMessageId: event.data.messageId },
    });
  },
);

/** Pure database maintenance; no Gmail requests or model calls. */
export const cardHygieneWorker = inngest.createFunction(
  { id: 'proactive-card-expiry', retries: 1, concurrency: 1, triggers: [{ cron: '40 * * * *' }] },
  async ({ step }) => step.run('expire-and-nudge', () => cleanUpCards()),
);

export const proactiveEngineFunctions = [leaveNowWorker, followUpTimerWorker, cardHygieneWorker];
