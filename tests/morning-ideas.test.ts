import assert from 'node:assert/strict';
import test from 'node:test';
import { morningDay } from '../lib/proactive/morning-jobs';
import { morningMessageText, type MorningContext } from '../lib/proactive/morning-context';
import { morningDecisions, morningProviderOptions, morningSuggestionHistory, keepNovelMorningReviews, validateMorningIdeas, type MorningIdea, type MorningReport, MORNING_IDEAS_MODEL } from '../lib/proactive/morning-ideas';
import { existingDecisionContextFromWorkspace } from '../lib/discovery/existing-decisions';
import type { WorkspaceStateData } from '../lib/types';
import { createTemporalContext } from '../lib/temporal';

const now = new Date('2026-09-15T10:00:00Z');
const context = { temporal: createTemporalContext('America/Toronto', now), facts: [], conversations: [{ ref: 'chat:1', sourceType: 'manual' }], emails: [], calendar: [] } as unknown as MorningContext;
const idea: MorningIdea = { topicKey: 'personal-goal', title: 'A personal goal', body: 'Want help with your next step?', category: 'social', personalReason: 'The user explicitly asked for this.', personalRefs: ['chat:1'], sourceUrls: ['https://example.com/event'], whyNow: 'The event is tomorrow.', expiresAt: '2026-09-16T10:00:00Z', primary: { label: 'Find a time', intent: 'Research suitable times.', actionType: 'research' }, alternative: { label: 'Leave it', intent: 'Keep existing plans.', actionType: 'no_action' } };

test('morning boundaries follow local time through DST and half-hour zones', () => {
  assert.equal(morningDay('America/Toronto', new Date('2026-09-15T09:59:59Z')), null);
  assert.equal(morningDay('America/Toronto', now), '2026-09-15');
  assert.equal(morningDay('America/Toronto', new Date('2026-09-15T16:00:00Z')), null);
  assert.equal(morningDay('America/Toronto', new Date('2026-11-01T11:00:00Z')), '2026-11-01');
  assert.equal(morningDay('America/Toronto', new Date('2026-03-08T10:00:00Z')), '2026-03-08');
  assert.equal(morningDay('Asia/Kolkata', new Date('2026-09-15T00:30:00Z')), '2026-09-15');
  assert.equal(morningDay('Pacific/Auckland', new Date('2026-09-14T18:00:00Z')), '2026-09-15');
  assert.equal(morningDay('invalid', now), null);
  assert.equal(morningDay(null, now), null);
});

test('personal chat extraction excludes tool and hidden content and redacts labeled secrets', () => {
  assert.equal(morningMessageText({ role: 'tool', content: 'private tool body' }), null);
  assert.deepEqual(morningMessageText({ role: 'assistant', content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'hello' }, { type: 'file', data: 'secret' }] }), { role: 'assistant', text: 'hello' });
  assert.equal(morningMessageText({ role: 'user', content: 'password: abc123 hello' })?.text, '[redacted secret] hello');
});

test('unverified evidence, expired windows, duplicates and empty primary actions cannot publish', () => {
  const check = (candidate: MorningIdea) => validateMorningIdeas([candidate], context, new Set(idea.sourceUrls), []);
  assert.equal(check(idea).accepted.length, 1);
  assert.equal(check({ ...idea, personalRefs: ['chat:someone-else'] }).accepted.length, 0);
  assert.equal(check({ ...idea, sourceUrls: ['https://invented.test'] }).accepted.length, 0);
  assert.equal(check({ ...idea, expiresAt: '2026-09-14T00:00:00Z' }).accepted.length, 0);
  assert.equal(check({ ...idea, expiresAt: '2026-09-23T00:00:00Z' }).accepted.length, 0);
  assert.equal(check({ ...idea, expiresAt: '2026-09-16T10:00:00' }).accepted.length, 0);
  assert.equal(check({ ...idea, primary: idea.alternative }).accepted.length, 0);
  assert.equal(validateMorningIdeas([idea, idea], context, new Set(idea.sourceUrls), []).accepted.length, 1);
  assert.equal(validateMorningIdeas([idea], context, new Set(idea.sourceUrls), [{ localDate: '2026-09-14', ideas: [idea] }]).accepted.length, 0);
});

test('expired and archived morning offers remain explicit comparison context and block repeated topics', () => {
  const [old] = morningDecisions('owner@example.com', { localDate: '2026-09-14', ideas: [idea] } as MorningReport, now);
  old.actionableUntil = '2026-09-14T12:00:00Z';
  const workspace = { decisions: [old], tasks: [], history: [], discardedDecisionIds: [] } as unknown as WorkspaceStateData;
  assert.equal(existingDecisionContextFromWorkspace(workspace, now.getTime()).length, 0, 'Other discovery callers keep their existing expiry behavior');
  const existing = existingDecisionContextFromWorkspace(workspace, now.getTime(), { includeExpired: true }).map(item => ({ ...item, archived: true }));
  const current = { ...context, existing };
  const history = morningSuggestionHistory(current, [{ localDate: '2026-09-13', ideas: [{ ...idea, topicKey: 'another-topic' }] }]);
  assert.equal(history.length, 2);
  assert.equal(history[0].primaryIntent, idea.primary.intent);
  assert.equal(history[1].body, idea.body);
  assert.equal(history[1].archived, true);
  assert.equal(history[1].topicKey, idea.topicKey);
  assert.equal(validateMorningIdeas([idea], current, new Set(idea.sourceUrls), []).accepted.length, 0);
});

test('semantic review rejects renamed repeats and same-batch overlap even with a contradictory keep verdict', () => {
  const renamed = { ...idea, title: 'Another afternoon', topicKey: 'different-wording' };
  const distinct = { ...idea, title: 'New experience', topicKey: 'distinct-experience' };
  const reviewed = keepNovelMorningReviews([renamed, idea, distinct], [
    { index: 0, keep: true, duplicateOf: 'morning:2026-09-14:personal-goal', reason: 'Same outing with a changed title.' },
    { index: 1, keep: false, duplicateOf: 'candidate:0', reason: 'Same proposed action.' },
    { index: 2, keep: true, duplicateOf: null, reason: 'A different verified experience.' },
  ]);
  assert.deepEqual(reviewed.kept, [distinct]);
  assert.equal(reviewed.withheld.length, 2);
  assert.equal(keepNovelMorningReviews([idea], []).kept.length, 0);
  const verdict = { index: 0, keep: true, duplicateOf: null, reason: 'Distinct' };
  assert.equal(keepNovelMorningReviews([idea], [verdict, verdict]).kept.length, 0);
});

test('Luna always uses standard tier and generated choices retain execution intent with stable owner/day IDs', () => {
  assert.equal(MORNING_IDEAS_MODEL, 'gpt-6-luna');
  assert.equal(morningProviderOptions.openai.serviceTier, 'default');
  assert.equal(morningProviderOptions.openai.reasoningEffort, 'medium');
  const report = { localDate: '2026-09-15', ideas: [idea] } as MorningReport;
  const [card] = morningDecisions('owner@example.com', report, now);
  assert.equal(card.options[0].sublabel, idea.primary.intent);
  assert.equal(card.options[1].actionType, 'no_action');
  assert.equal(card.id, morningDecisions('OWNER@example.com', report, now)[0].id);
  assert.notEqual(card.id, morningDecisions('other@example.com', report, now)[0].id);
  assert.notEqual(card.id, morningDecisions('owner@example.com', { ...report, localDate: '2026-09-16' }, now)[0].id);
});


test('email references and a generic profile cannot be the origin of a morning idea', () => {
  const withEmail = { ...context, emails: [{ ref: 'email:1' }] };
  const check = (personalRefs: string[]) => validateMorningIdeas([{ ...idea, personalRefs }], withEmail, new Set(idea.sourceUrls), []);
  assert.equal(check(['email:1']).accepted.length, 0);
  assert.equal(check(['profile']).accepted.length, 0);
  assert.equal(check(['chat:1']).accepted.length, 1);
});

test('Gmail verification rejects missing or email anchors before calling the shared tool', async () => {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const { anchoredMorningEmailTool } = await import('../lib/proactive/morning-tools');
  const calls: unknown[] = [];
  const original = tool({ inputSchema: z.object({ query: z.string(), scope: z.string() }), execute: async input => { calls.push(input); return { count: 0 }; } });
  const guarded = anchoredMorningEmailTool(original, context, 'gmail_search_messages');
  const options = { toolCallId: 'test', messages: [], context: {} };
  await guarded.execute!({ query: 'anything', scope: 'recent_scan', personalAnchorRef: 'email:1' }, options);
  await guarded.execute!({ query: 'anything', scope: 'recent_scan', personalAnchorRef: 'chat:unknown' }, options);
  assert.equal(calls.length, 0);
  await guarded.execute!({ query: 'specific plan', scope: 'recent_scan', personalAnchorRef: 'chat:1' }, options);
  assert.deepEqual(calls, [{ query: 'specific plan', scope: 'account_history' }]);
});


test('email-origin conversations cannot masquerade as personal chat grounding', () => {
  const sourced = { ...context, conversations: [{ ...context.conversations[0], sourceType: 'email' }] };
  assert.equal(validateMorningIdeas([idea], sourced, new Set(idea.sourceUrls), []).accepted.length, 0);
});

test('shared-registry truncated results preserve explicit source URLs', async () => {
  const { collectMorningUrls } = await import('../lib/proactive/morning-tools');
  const urls = new Set<string>();
  collectMorningUrls({ truncated: true, preview: '{"results":[{"url":"https://example.com/verified","text":"unfinished' }, urls);
  assert.deepEqual([...urls], ['https://example.com/verified']);
});

test('empty morning passes retry shallow research only when personal leads exist',async()=>{
 const {needsMorningResearchRetry}=await import('../lib/proactive/morning-ideas');
 assert.equal(needsMorningResearchRetry(context,0,[{tool:'check_current_time',ok:true}]),true);
 assert.equal(needsMorningResearchRetry(context,0,[{tool:'web_search_exa',ok:true}]),true);
 assert.equal(needsMorningResearchRetry(context,0,[{tool:'web_search_exa',ok:true},{tool:'web_search_exa',ok:true}]),false);
 assert.equal(needsMorningResearchRetry(context,1,[]),false);
 assert.equal(needsMorningResearchRetry({...context,conversations:[],facts:[],calendar:[]},0,[]),false);
 assert.equal(needsMorningResearchRetry({...context,conversations:[{ref:'email-chat',sourceType:'email'}] as any},0,[]),false);
});
test('offer expiry enforces exactly the same 72-hour maximum as the prompt',()=>{
 assert.equal(validateMorningIdeas([{...idea,expiresAt:'2026-09-18T10:00:00Z'}],context,new Set(idea.sourceUrls),[]).accepted.length,1);
 assert.equal(validateMorningIdeas([{...idea,expiresAt:'2026-09-18T10:00:01Z'}],context,new Set(idea.sourceUrls),[]).accepted.length,0);
});
test('new-value review can reference an old offer without rejecting a justified due-goal renewal',()=>{
 const lead={ref:'opportunity:personal-goal',topicKey:idea.topicKey,status:'open',kind:'goal',due:true,summary:'The goal was blocked, not completed.',lastOffer:{topicKey:idea.topicKey,title:idea.title,body:idea.body,whyNow:'Old timing',intent:idea.primary.intent,decisionId:'old'}};
 const current={...context,opportunities:[lead],existing:[]} as unknown as MorningContext;
 const candidate={...idea,personalRefs:[lead.ref],whyNow:'The blocker may have cleared at the next sensible time.'};
 const review={index:0,keep:true,duplicateOf:'last-offer:personal-goal',classification:'renewed_goal' as const,newValue:'The temporary blocker and useful check time have changed.',reason:'A useful recheck of an unmet goal.'};
 assert.equal(keepNovelMorningReviews([candidate],[review],current).kept.length,1);
 assert.equal(keepNovelMorningReviews([candidate],[{...review,classification:'duplicate_offer'}],current).kept.length,0);
 assert.equal(keepNovelMorningReviews([candidate],[{...review,newValue:null}],current).kept.length,0);
 assert.equal(keepNovelMorningReviews([candidate],[{...review,duplicateOf:'candidate:0'}],current).kept.length,0);
 assert.equal(keepNovelMorningReviews([candidate],[review],{...current,opportunities:[{...lead,due:false}]} as unknown as MorningContext).kept.length,0);
 assert.equal(validateMorningIdeas([candidate,candidate],current,new Set(idea.sourceUrls),[]).accepted.length,1);
});
