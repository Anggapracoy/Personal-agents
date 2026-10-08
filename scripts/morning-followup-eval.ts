// Synthetic regression evaluation; no account data, tools, publication or notifications.
import assert from 'node:assert/strict';
import { openai } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MORNING_IDEAS_MODEL, morningIdeasSystem, morningProviderOptions } from '../lib/proactive/morning-ideas';

const cases = [
  { name: 'temporarily blocked', outcome: 'All restaurants were closed. User said: done for tonight.', offer: true },
  { name: 'fulfilled later', outcome: 'Restaurants were closed, but a later conversation confirms steak was ordered and delivered.', offer: false },
  { name: 'explicit rejection', outcome: 'User said: I do not want steak anymore. Stop suggesting it.', offer: false },
  { name: 'unanswered follow-up', outcome: 'Restaurants were closed. A next-day lunch or dinner check-in was already offered and remains unanswered.', offer: false },
];
for (const sample of cases) {
  const result = await generateText({
    model: openai(MORNING_IDEAS_MODEL), system: morningIdeasSystem, providerOptions: morningProviderOptions,
    prompt: `Evaluate just this synthetic lead for a morning pass the next day. A manual user chat requested steak takeout. The run status is done. Outcome: ${sample.outcome} No other context or leads exist. Should an offer to check steak options for lunch or dinner survive the novelty rules? Do not assume restaurants are open.`,
    output: Output.object({ schema: z.object({ offer: z.boolean(), reason: z.string() }) }),
    maxRetries: 0, abortSignal: AbortSignal.timeout(60000),
  });
  console.log(JSON.stringify({ case: sample.name, ...result.output }));
  assert.equal(result.output.offer, sample.offer, sample.name);
}
