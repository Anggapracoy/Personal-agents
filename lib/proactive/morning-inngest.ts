import { refreshOpportunities, claimOpportunityChecks } from './opportunities';
import { deliverPendingPushNotifications } from '../push-notifications';
import { isMorningAllowed } from './morning-access';
import { inngest } from '../harness/inngest-client';
import { loadMorningContext, type MorningContext } from './morning-context';
import { generateMorningIdeas } from './morning-ideas';
import { claimMorning, dueMorningAccounts, failMorning, previousMorningIdeas, publishMorning } from './morning-jobs';

export const morningSweepWorker = inngest.createFunction(
  { id: 'dispatch-morning-ideas', retries: 3, concurrency: 1, triggers: [{ cron: '* * * * *' }] },
  async ({ step }) => {
    const due = await step.run('find-local-mornings', () => dueMorningAccounts());
    // Atomic database claims deduplicate deliveries, allowing recovery if dispatch fails before claim.
    if (due.length) await step.sendEvent('dispatch-mornings', due.map(account => ({
      name: 'decision-feed/morning.due', data: account,
    })));
    return { due: due.length };
  },
);

export const morningIdeasWorker = inngest.createFunction(
  { id: 'generate-morning-ideas', retries: 0, concurrency: [{ limit: 1, key: 'event.data.owner' }],
    triggers: [{ event: 'decision-feed/morning.due' }] },
  async ({ event, step }) => {
    const { owner, timeZone, localDate } = event.data as { owner: string; timeZone: string; localDate: string };
    const attempt = await step.run('claim-local-day', () => claimMorning(owner, timeZone, localDate));
    if (!attempt) return { skipped: true };
    try {
      await step.run('update-opportunity-memory', async()=>{ if(!await isMorningAllowed(owner))return; await refreshOpportunities(owner); });
      const checked=await step.run('claim-due-opportunities',()=>claimOpportunityChecks(owner));
      const input = await step.run('read-personal-context', async () => {
        const [context, previous] = await Promise.all([loadMorningContext(owner,new Date(),checked), previousMorningIdeas(owner)]);
        if (context.temporal.currentLocalDate !== localDate || context.temporal.userTimeZone !== timeZone) throw new Error('Local day or timezone changed before discovery.');
        return { context, previous };
      });
      const report = await step.run('research-and-review', async () => {
        if (!await isMorningAllowed(owner)) throw new Error('Daily proactive access was disabled.');
        return generateMorningIdeas(input.context as MorningContext, input.previous);
      });
      const published = await step.run('publish-and-queue-notifications', () => publishMorning(owner, report, attempt,undefined,checked));
      // Already awake (or past 8:30)? The bundle goes out now; otherwise delivery waits for waking.
      if (published.published) await step.run('deliver-morning-notifications', () => deliverPendingPushNotifications({ownerEmail:owner,includeRecent:true}));
      return published;
    } catch (error) {
      await step.run('record-failure', () => failMorning(owner, localDate, error, attempt));
      throw error;
    }
  },
);
