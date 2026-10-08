import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localClock, mutedByPreferences, topicKey } from '../lib/proactive/engine/rules';
import { answerEtaCheck, leaveTiming, travelDestination } from '../lib/proactive/engine/detectors/leave-now';
import { looksHuman } from '../lib/proactive/engine/detectors/loops';
import { expiredUndatedCards } from '../lib/proactive/engine/detectors/hygiene';
import { PROACTIVE_MAX_STEPS, PROACTIVE_MODEL_ID, proactiveProviderOptions, proactiveSystem, toolUseGuidance } from '../lib/proactive/engine/model';
import { engineDiscoveryGuidance } from '../lib/proactive/engine/guidance';
import { isMorningAllowed } from '../lib/proactive/morning-access';

import { prefilterEmail } from '../lib/discovery/prefilter';
import type { Decision } from '../lib/types';

const card = (overrides: Partial<Decision> = {}): Decision => ({
  id: 'card-1', sourceType: 'email', category: 'shopping', urgency: 'medium', title: 'Return the headphones', subtitle: 'The return window closes Friday.',
  originalContext: 'Order #123. Return by Friday.', options: [], dismissLabel: 'Not now', createdAt: new Date().toISOString(), ...overrides,
});

test('muted senders and “less like this” topics are filtered', () => {
  const email = card({ sourceLabel: 'Uber Eats', executionContext: { sourceEmail: { messageId: 'm', threadId: 't', from: 'Uber Eats <promo@uber.com>', to: 'me@x.com', subject: '', date: '', snippet: '', body: '', links: [], confirmationNumbers: [], attachments: [] } } });
  assert.equal(mutedByPreferences(email, { mutedSenders: ['promo@uber.com'], mutedTopics: [] }), true);
  assert.equal(mutedByPreferences(email, { mutedSenders: [], mutedTopics: [topicKey(email)] }), true);
  assert.equal(mutedByPreferences(email, { mutedSenders: ['other@x.com'], mutedTopics: [] }), false);
});

test('leave-now skips virtual meetings and knows when you are late', () => {
  assert.equal(travelDestination({ id: '1', location: 'https://zoom.us/j/123', start: { dateTime: '2026-09-25T15:00:00Z' } }), null);
  assert.equal(travelDestination({ id: '2', location: 'Google Meet', start: { dateTime: '2026-09-25T15:00:00Z' } }), null);
  assert.equal(travelDestination({ id: '3', location: '123 King St W, Toronto', start: { date: '2026-09-25' } }), null, 'all-day');
  assert.equal(travelDestination({ id: '4', location: '123 King St W, Toronto', start: { dateTime: '2026-09-25T15:00:00Z' } }), '123 King St W, Toronto');
  const start = new Date('2026-09-25T15:00:00Z');
  const onTime = leaveTiming(start, 30, new Date('2026-09-25T14:00:00Z'));
  assert.equal(onTime.late, false);
  assert.equal(onTime.leaveBy.toISOString(), '2026-09-25T14:20:00.000Z');
  const late = leaveTiming(start, 30, new Date('2026-09-25T14:45:00Z'));
  assert.equal(late.late, true);
  assert.equal(late.lateMinutes, 15);
});

test('open loops are only real people', () => {
  const base = { subject: 'Friday?', snippet: 'Are you free Friday?', body: 'Are you free Friday for dinner?', listUnsubscribe: '', precedence: '', autoSubmitted: '', to: 'me@x.com', date: '', id: '1', threadId: 't', links: [], confirmationNumbers: [], attachments: [], labels: [], replyTo: '' };
  assert.equal(looksHuman({ ...base, from: 'Sam Lee <sam@gmail.com>' }), true);
  assert.equal(looksHuman({ ...base, from: 'Shop <no-reply@shop.com>' }), false);
  assert.equal(looksHuman({ ...base, from: 'News <editor@news.com>', listUnsubscribe: '<mailto:unsub@news.com>' }), false);
});

test('undated suggestions expire after two weeks; dated, started and manual ones stay', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const old = '2026-09-01T12:00:00Z';
  const decisions = [card({ id: 'old', createdAt: old }), card({ id: 'dated', createdAt: old, actionableUntil: '2026-10-01T00:00:00Z' }),
    card({ id: 'started', createdAt: old, activeRunId: 'r' }), card({ id: 'manual', createdAt: old, sourceType: 'manual' }), card({ id: 'fresh', createdAt: '2026-09-20T12:00:00Z' })];
  assert.deepEqual(expiredUndatedCards(decisions, now).map(item => item.id), ['old']);
});

test('the engine uses Luna on low with caching, the standard tier and no stored responses', () => {
  assert.equal(PROACTIVE_MODEL_ID, 'gpt-6-luna');
  const options = proactiveProviderOptions().openai;
  assert.equal(options.reasoningEffort, 'low');
  assert.equal(options.serviceTier, 'default');
  assert.equal(options.store, false);
  assert.ok('promptCacheOptions' in options, 'prompt caching is on');
  const system = proactiveSystem('stable instructions', 'user context');
  assert.ok(Array.isArray(system));
  assert.deepEqual((system as Array<{ providerOptions?: unknown }>)[0].providerOptions, { openai: { promptCacheBreakpoint: { mode: 'explicit' } } });
  // Tool use is limited by the prompt; the step ceiling only stops runaway loops.
  assert.match(toolUseGuidance, /only when/);
  assert.ok(PROACTIVE_MAX_STEPS >= 12);
  const engineSources = ['judge.ts', 'model.ts'].map(name => readFileSync(new URL(`../lib/proactive/engine/${name}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(engineSources, /serviceTier:\s*['"]priority/);
});

test('v2 is gated by the daily proactive flag', async () => {
  const db = (value: object) => ({ execute: async () => [{ value, revision: 0 }] }) as never;
  assert.equal(await isMorningAllowed('unlisted@example.invalid', db({ mode: 'selected', users: [] })), false);
  assert.equal(await isMorningAllowed('someone@example.invalid', db({ mode: 'selected', users: [] })), false);
  assert.equal(await isMorningAllowed('someone@example.invalid', db({ mode: 'selected', users: [{ email: 'someone@example.invalid', enabled: true }] })), true);
});

test('discovery only widens for v2 users', () => {
  const delivery = { id: 'e', threadId: 't', subject: 'Delivery attempted: signature required', from: 'UPS <updates@ups.com>', to: 'me@x.com', date: '', snippet: 'We tried to deliver your package.', body: 'Signature required. We will try again tomorrow. Unsubscribe', links: [], confirmationNumbers: [], attachments: [], labels: [], listUnsubscribe: '<mailto:u@ups.com>', precedence: 'bulk', autoSubmitted: '', replyTo: '' };
  assert.equal(prefilterEmail(delivery, { engine: true }).bucket, 'strong_candidate');
  assert.notEqual(prefilterEmail(delivery).bucket, 'strong_candidate');
  assert.match(engineDiscoveryGuidance, /Flight check-in/);
  const harness = readFileSync(new URL('../lib/discovery/harness.ts', import.meta.url), 'utf8');
  assert.match(harness, /input\.proactiveGuidance \?/);
});


test('late phone ETA replies do not create suggestions after proactive is turned off', async () => {
  let queries = 0;
  const db = { execute: async () => { queries++; return [{ value: { mode: 'none', users: [] }, revision: 2 }]; } };
  const result = await answerEtaCheck('user@example.com', 'unused', 12, new Date(), db as never);
  assert.deepEqual(result, { accepted: false, candidate: false });
  assert.equal(queries, 1, 'only the flag is read; no ETA update, card, or candidate');
});

test('background calendar paths are gated while requested scans stay available', () => {
  const worker = readFileSync(new URL('../lib/discovery/google-push-worker.ts', import.meta.url), 'utf8');
  const calendar = worker.slice(worker.indexOf('async function processCalendarChange'), worker.indexOf('export async function processGoogleSourceChange'));
  assert.ok(calendar.indexOf('proactiveEngineEnabled(context.ownerEmail)') < calendar.indexOf('fetchUpcomingEvents('));
  assert.match(worker, /if \(!requestedScan && !await proactiveEngineEnabled\(ownerEmail\)\) return \[\]/);
  assert.match(worker, /proactiveCalendarCards\(input.ownerEmail, events, source, prefix, "google", true\)/);
  const sweep = worker.slice(worker.indexOf('export async function processProactiveSweep'), worker.indexOf('export async function processManualGoogleScan'));
  assert.ok(sweep.indexOf('proactiveEngineEnabled(ownerEmail)') < sweep.indexOf('getUsableGoogleConnections(ownerEmail)'));
});
