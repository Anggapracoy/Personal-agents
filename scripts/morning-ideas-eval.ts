import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadMorningContext } from '../lib/proactive/morning-context';
import { previousMorningIdeas } from '../lib/proactive/morning-jobs';
import { generateMorningIdeas, morningDecisions } from '../lib/proactive/morning-ideas';
const owner = process.argv[process.argv.indexOf('--owner') + 1];
if (!process.argv.includes('--owner') || !owner?.includes('@')) throw new Error('Provide --owner account@email');
const output = resolve(process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : 'artifacts/morning-ideas/evaluation.json');
async function main() {
  const [context, previous] = await Promise.all([loadMorningContext(owner), previousMorningIdeas(owner)]);
  console.log(JSON.stringify({ stage: 'context', timeZone: context.temporal.userTimeZone, localDate: context.temporal.currentLocalDate,
    conversations: context.conversations.length, userMessages: context.conversations.reduce((sum, run) => sum + run.messages.filter(message => message.role === 'user').length, 0),
    facts: context.facts.length, emails: context.emails.length, events: context.calendar.length, calendarComplete: context.calendarComplete, warnings: context.warnings }));
  const report = await generateMorningIdeas(context, previous, message => console.log(message));
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify({ report, decisions: morningDecisions(owner, report) }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ output, model: report.model, serviceTier: report.serviceTier, durationMs: report.durationMs, ideas: report.ideas, withheld: report.withheld }, null, 2));
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
