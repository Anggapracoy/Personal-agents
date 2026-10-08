import assert from "node:assert/strict";
import test from "node:test";
import { conversationTimeLabel } from "../app/message-time";
import { conversationItems } from "../app/conversations";
import { discardThreadOptions, threadItems } from "../lib/harness/thread";
import type { Decision, HistoryEntry, RunningTask } from "../lib/types";
const decision = (id: string, sourceType: Decision["sourceType"] = "manual"): Decision => ({ id, sourceType, category: "travel", urgency: "medium", title: id, subtitle: "Hello", originalContext: "Context", options: [], dismissLabel: "Not now", createdAt: "2026-09-05T10:00:00Z" });
const history: HistoryEntry = { id: "receipt", decisionId: "trip", runId: "run", category: "travel", title: "Trip", subtitle: "Booked", outcome: "Booked at eight", originalContext: "Context", chosenOption: "Book", steps: [], time: "11:00", completedAt: "2026-09-05T11:00:00Z", group: "TODAY", status: "done" };
test("manual and proactive chats coexist with completed conversations ordered by activity", () => {
 const rows = conversationItems([decision("manual"), decision("proactive", "email")], [], [history], undefined, {}, { "decision:trip": { text: "Booked at eight", createdAt: "2026-09-05T10:59:59Z" } });
 assert.deepEqual(new Set(rows.map(r => r.id)), new Set(["manual", "proactive", "receipt"]));
 assert.equal(rows[0].id, "receipt");
 assert.equal(rows[0].line, "Booked at eight");
 assert.notEqual(rows[0].state, "done");
});
test("resuming and completing the same conversation never creates duplicate Home rows", () => {
 const task: RunningTask = { id: "task", runId: "run", decisionId: "trip", category: "travel", title: "Trip", subtitle: "Changing the booking", status: "running", chosenOption: "Change it", originalContext: "Context", updatedAt: "2026-09-05T12:00:00Z" };
 const rows = conversationItems([{ ...decision("trip"), activeRunId: "run" }], [task], [history]);
 assert.equal(rows.length, 1); assert.equal(rows[0].id, "task");
 const finished = conversationItems([decision("trip")], [], [history, { ...history, id: "new-receipt", completedAt: "2026-09-05T13:00:00Z" }]);
 assert.equal(finished.length, 1); assert.equal(finished[0].id, "new-receipt");
});
test("old and dismissed conversations remain available beyond the first Home page", () => {
 const rows = conversationItems(Array.from({ length: 100 }, (_, i) => decision(`chat-${i}`)), [], [{ ...history, status: "dismissed" }]);
 assert.equal(rows.length, 101); assert.ok(rows.some(r => r.id === "receipt"));
});

test("a reply to a finished run preserves context and replaces the old result", async () => {
 const { MemoryRunStore } = await import("../lib/harness/store");
 const { appendConversationReply } = await import("../lib/harness/conversation-reply");
 const { runAgent } = await import("../lib/harness/run");
 const store = new MemoryRunStore();
 const run = await store.createRun({ userId: "conversation-test", decisionId: "trip", category: "travel", request: "Book dinner", title: "Dinner", metadata: {} });
 await store.appendMessages(run.id, [{ role: "user", content: "Book dinner" }]);
 await store.updateRun(run.id, { status: "done", result: { outcome: "completed", summary: "Booked at seven", details: "For two", verified: true, externalChange: true, options: [], followUpActions: [], facts: [], links: [{ label: "Booking", url: "https://example.com/booking" }], moneySaved: null, recommendedNextStep: null } });
 await appendConversationReply(store, run.id, "Actually eight please");
 assert.equal((await store.getRun(run.id))?.result, null);
 const messages = await store.listMessages(run.id);
 assert.match(JSON.stringify(messages), /Booked at seven/);
 assert.match(JSON.stringify(messages), /Actually eight please/);
 await runAgent({ runId: run.id, store, model: { turn: async ({ onNarration }) => { await onNarration("Eight is available. Shall I change it?"); } } });
 assert.equal((await store.getRun(run.id))?.result?.summary, "Eight is available. Shall I change it?");
});

test("text replies discard old options without losing messages, and fresh choices can appear later", async () => {
 const { MemoryRunStore } = await import("../lib/harness/store");
 const { appendConversationReply } = await import("../lib/harness/conversation-reply");
 const store = new MemoryRunStore();
 const run = await store.createRun({ userId: "reply-options-test", decisionId: null, category: "food", request: "Find dinner", title: "Dinner", metadata: {} });
 await store.appendMessages(run.id, [{ role: "user", content: "Find dinner" }, { role: "assistant", content: "which one do u prefer?" }]);
 const result = { outcome: "needs_user" as const, summary: "which one do u prefer?", details: "which one do u prefer?", verified: true, externalChange: false, options: [{ id: "a", name: "Dinner A", description: "First choice", status: "Available", sourceUrl: null, recommended: true }], followUpActions: [], facts: [], links: [], moneySaved: null, recommendedNextStep: null };
 await store.updateRun(run.id, { status: "done", response: result.summary, result });
 const original = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
 assert.equal(original.at(-1)?.kind, "options");
 assert.deepEqual(discardThreadOptions(original).map(item => item.kind), ["user", "agent"]);
 // Optimistic hiding doesn't destroy the source list, so failed sends can restore it.
 assert.equal(original.at(-1)?.kind, "options");
 await appendConversationReply(store, run.id, "Actually something cheaper");
 const reloaded = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
 assert.equal(reloaded.some(item => item.kind === "options"), false);
 const reply = reloaded.at(-1);
 assert.equal(reply?.kind === "user" && reply.text, "Actually something cheaper");
 await store.appendMessages(run.id, [{ role: "assistant", content: "this one is cheaper" }]);
 await store.updateRun(run.id, { status: "done", result: { ...result, options: [{ ...result.options[0], id: "b", name: "Dinner B" }] } });
 const fresh = threadItems((await store.getSnapshot(run.id))!, await store.listMessages(run.id));
 const choices = fresh.find(item => item.kind === "options");
 assert.equal(choices?.kind === "options" && choices.options?.[0]?.name, "Dinner B");
});

test("follow-up keeps one completion bubble and hides legacy injected result blocks", async () => {
 const { MemoryRunStore } = await import('../lib/harness/store');
 const { appendConversationReply } = await import('../lib/harness/conversation-reply');
 const store = new MemoryRunStore();
 const run = await store.createRun({ userId:'thanks-test', decisionId:null, category:'schedule', request:'Confirm Tuesday', title:'Tuesday', metadata:{} });
 const result = {outcome:'completed' as const,summary:'Confirmed Tuesday.',details:'Sent a reply in the existing email thread.',verified:true,externalChange:true,options:[],followUpActions:[],facts:[],links:[],moneySaved:null,recommendedNextStep:null};
 await store.appendMessages(run.id,[{role:'user',content:'Confirm Tuesday'},{role:'assistant',content:[{type:'tool-call',toolCallId:'result-1',toolName:'present_result',input:result}]},{role:'assistant',content:'done, confirmed Tuesday'}]);
 await store.updateRun(run.id,{status:'done',response:'done, confirmed Tuesday',result});
 await appendConversationReply(store,run.id,'Thank you');
 const visible=threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id));
 assert.deepEqual(visible.filter(item=>item.kind==='agent').map(item=>item.text),['done, confirmed Tuesday']);
 assert.ok(JSON.stringify(await store.listMessages(run.id)).includes('Confirmed Tuesday.'));
 const legacy=await store.createRun({userId:'legacy-thanks',decisionId:null,category:'schedule',request:'Confirm Tuesday',title:'Tuesday',metadata:{}});
 await store.appendMessages(legacy.id,[{role:'user',content:'Confirm Tuesday'},{role:'assistant',content:[{type:'tool-call',toolCallId:'r2',toolName:'present_result',input:result}]},{role:'assistant',content:'done, confirmed Tuesday'},{role:'assistant',content:result.summary+'\n\n'+result.details},{role:'user',content:'Thank you'},{role:'assistant',content:'np'}]);
 assert.deepEqual(threadItems((await store.getSnapshot(legacy.id))!,await store.listMessages(legacy.id)).filter(item=>item.kind==='agent').map(item=>item.text),['done, confirmed Tuesday','np']);
});

test('latest outgoing text becomes the list preview without manufacturing unread activity', () => {
 const rows = conversationItems([], [], [history], Date.parse('2026-09-05T12:01:00Z'), {}, {
  'decision:trip': { kind: 'user', text: 'Actually eight please', createdAt: '2026-09-05T12:00:00Z', unreadCount: 0 },
 });
 assert.equal(rows[0].line, 'Actually eight please');
 assert.equal(rows[0].preview?.at(-1)?.kind, 'user');
 assert.equal(rows[0].unread, false); assert.equal(rows[0].unreadCount, 0);
});
test('an outgoing preview retains unread incoming messages until read through them', () => {
 const messages = { 'decision:trip': { kind: 'user' as const, text: 'Thanks', createdAt: '2026-09-05T12:00:00Z', incomingAt: '2026-09-05T11:59:00Z', unreadCount: 2 } };
 const unread = conversationItems([], [], [history], undefined, {}, messages)[0];
 assert.equal(unread.line, 'Thanks'); assert.equal(unread.unreadCount, 2);
 const read = conversationItems([], [], [history], undefined, { 'decision:trip': { lastReadAt: '2026-09-05T11:59:00Z' } }, messages)[0];
 assert.equal(read.unread, false); assert.equal(read.unreadCount, 0);
});
test('background completion does not reorder a conversation above a newer real message', () => {
 const older = { ...history, completedAt: '2026-09-05T14:00:00Z' };
 const newer = { ...history, id: 'other', decisionId: 'other', runId: 'other-run' };
 const rows = conversationItems([], [], [older, newer], undefined, {}, {
  'decision:trip': { text: 'Older reply', createdAt: '2026-09-05T11:00:00Z' },
  'decision:other': { kind: 'user', text: 'Newer message', createdAt: '2026-09-05T12:00:00Z' },
 });
 assert.equal(rows[0].id, 'other');
});

test('only unanswered proactive decisions carry expanded Home content', () => {
 const suggestion = { ...decision('suggestion', 'email'), sourceLabel: 'Gmail', options: [{ id: 'skip', label: 'Do nothing', actionType: 'no_action' as const }, { id: 'go', label: 'Check options', actionType: 'research' as const, isPrimary: true }] };
 const row = conversationItems([suggestion, decision('manual')], [], [history]).find(row => row.id === suggestion.id)!;
 assert.deepEqual(row.proactive, { personalized: false, context: 'Gmail', body: 'Hello', option: { id: 'go', label: 'Check options' }, alternative: { id: 'skip', label: 'Do nothing' } });
 assert.equal(conversationItems([decision('manual')], [], [])[0].proactive, undefined);
 assert.equal(conversationItems([{ ...suggestion, activeRunId: 'run' }], [], [])[0].proactive, undefined);
 const task: RunningTask = { id: 'task', decisionId: suggestion.id, runId: 'run', category: 'travel', title: 'Trip', subtitle: 'Approval needed', status: 'needs_approval', chosenOption: 'Check options', originalContext: 'Context' };
 assert.equal(conversationItems([suggestion], [task], [])[0].proactive, undefined);
 assert.equal(conversationItems([suggestion], [], [{ ...history, decisionId: suggestion.id }])[0].proactive, undefined);
 assert.ok(conversationItems([suggestion], [], [], undefined, { 'decision:suggestion': { lastReadAt: '2026-09-06T00:00:00Z' } })[0].proactive);
});

test('archived conversations retain new results without unread badges or resurfacing', () => {
 const settings = { 'decision:trip': { archived: true, markedUnread: true } };
 const messages = { 'decision:trip': { kind: 'agent' as const, text: 'Your result is ready', createdAt: '2026-09-18T12:00:00Z', unreadCount: 3 } };
 const row = conversationItems([], [], [history], undefined, settings, messages)[0];
 assert.equal(row.archived, true);
 assert.equal(row.unread, false);
 assert.equal(row.unreadCount, 0);
 assert.equal(row.line, 'Your result is ready');
});

test('live activity is separate from message previews and clears when work stops', () => {
 const task: RunningTask = { id: 'live', decisionId: 'trip', runId: 'run', category: 'travel', title: 'Trip', subtitle: 'Reading', status: 'running', activity: { label: 'Reading the page', icon: 'browser' }, chosenOption: 'Check', originalContext: '' };
 const messages = { 'decision:trip': { text: 'Previous reply', createdAt: '2026-09-05T10:00:00Z' } };
 const running = conversationItems([], [task], [], undefined, {}, messages)[0];
 assert.equal(running.activity?.label, 'Reading the page');
 assert.equal(running.line, 'Previous reply');
 for (const status of ['waiting', 'needs_approval', 'failed'] as const) {
  assert.equal(conversationItems([], [{ ...task, status }], [], undefined, {}, messages)[0].activity, undefined);
 }
 assert.equal(conversationItems([], [], [history], undefined, {}, messages)[0].activity, undefined);
});

test('latest reactions move the conversation up and remain visible while thinking without adding unread', () => {
 const task: RunningTask = { id: 'live', decisionId: 'trip', runId: 'run', category: 'travel', title: 'Trip', subtitle: '', status: 'running', chosenOption: 'Check', originalContext: '' };
 const at = '2026-09-05T12:00:00Z';
 const rows = conversationItems([decision('other')], [task], [], Date.parse(at), {}, {
  'decision:other': { kind: 'agent', text: 'Other reply', createdAt: '2026-09-05T11:00:00Z' },
  'decision:trip': { kind: 'user', text: 'You reacted ❤️', reaction: true, createdAt: at, unreadCount: 0 },
 });
 assert.equal(rows[0].id, 'live');
 assert.equal(rows[0].line, 'You reacted ❤️');
 assert.equal(rows[0].activity, undefined);
 assert.equal(rows[0].unread, false);
 assert.equal(rows[0].unreadCount, 0);
 assert.equal(rows[0].time, conversationTimeLabel(at, Date.parse(at)));
});

test('durable waits replace stale feed previews and distinguish reply deadlines from timed wakes', () => {
 const base: RunningTask = { id: 'waiting-task', runId: 'waiting-run', decisionId: 'waiting-email', category: 'travel', title: 'Email', subtitle: 'Old activity', status: 'waiting', chosenOption: 'Send email', originalContext: '', updatedAt: '2026-09-26T02:08:00Z' };
 const wakeAt = '2026-09-29T02:08:00Z';
 const date = new Date(wakeAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
 const messages = { 'decision:waiting-email': { kind: 'agent' as const, text: 'An old message', createdAt: '2026-09-26T02:08:00Z' } };
 const rowFor = (eventKind: 'gmail_reply' | 'calendar_event_created' | null, wake: string | null = wakeAt) => conversationItems([], [{ ...base, automaticPause: { id: 'pause', ready: true, reason: 'Waiting for a reply', wakeAt: wake, eventKind } }], [], undefined, {}, messages)[0];
 assert.deepEqual(rowFor(null).activity, { icon: 'clock', label: `Waiting until ${date}` });
 assert.deepEqual(rowFor('gmail_reply').activity, { icon: 'clock', label: `Waiting for reply · Checks ${date}` });
 assert.equal(rowFor('calendar_event_created', null).activity?.label, 'Waiting for calendar event');
 assert.equal(rowFor(null, 'bad-date').activity?.label, 'Waiting · Waiting for a reply');
 const resumed = conversationItems([], [{ ...base, status: 'running' }], [], undefined, {}, messages)[0];
 assert.equal(resumed.activity?.label, 'Thinking');
});

test("proactive opening keeps its afternoon timestamp after a later reply and reload", async () => {
 const { MemoryRunStore } = await import("../lib/harness/store");
 const store = new MemoryRunStore();
 const suggestedAt = "2026-09-26T18:15:22.799Z";
 const repliedAt = "2026-09-27T06:00:00.000Z";
 const run = await store.createRun({ userId: "opening-time-test", decisionId: "intro", category: "work", request: "Draft a reply", title: "Intro", metadata: { sourceType: "email", retryDecision: { subtitle: "Want me to reply?", createdAt: suggestedAt }, initialReaction: "👍" } });
 await store.appendMessages(run.id, [{ role: "user", content: "Draft a reply" }]);
 const snapshot = { ...(await store.getSnapshot(run.id))!, createdAt: repliedAt };
 const messages = await store.listMessages(run.id);
 for (const saved of [snapshot, JSON.parse(JSON.stringify(snapshot))]) {
  const items = threadItems(saved, messages);
  assert.equal(items[0].kind === "agent" && items[0].createdAt, suggestedAt);
  assert.equal(items.find(item => item.kind === "user")?.createdAt, repliedAt);
  assert.equal(items[0].kind === "agent" && items[0].reactions?.[0].createdAt, repliedAt);
 }
 for (const createdAt of [undefined, null, "invalid", 123]) {
  const legacy = { ...snapshot, metadata: { ...snapshot.metadata, retryDecision: { subtitle: "Want me to reply?", createdAt } } };
  const opening = threadItems(legacy, messages)[0];
  assert.equal(opening.kind === "agent" && opening.createdAt, repliedAt);
 }
});




test('resumed tools bump feed time without unread messages and retain order after completion', () => {
 const activityAt = '2026-09-05T20:08:00Z';
 const task: RunningTask = { id: 'task', decisionId: 'trip', runId: 'run', title: 'Call', category: 'travel', subtitle: '', status: 'running', chosenOption: '', originalContext: '', activityAt, updatedAt: '2026-09-05T21:00:00Z' };
 const other = { ...history, id: 'other', decisionId: 'other' };
 const messages = { 'decision:trip': { text: 'Will call later', createdAt: '2026-09-05T15:00:00Z', unreadCount: 0 }, 'decision:other': { text: 'Hey', createdAt: '2026-09-05T19:00:00Z' } };
 const now = Date.parse('2026-09-05T21:00:00Z');
 for (const status of ['running','waiting'] as const) {
  const rows = conversationItems([], [{ ...task, status }], [other], now, {}, messages);
  assert.equal(rows[0].id, 'task');
  assert.equal(rows[0].time, conversationTimeLabel(activityAt, now));
  assert.equal(rows[0].unread, false);
 }
 const rows = conversationItems([], [], [{ ...history, activityAt }, other], now, {}, messages);
 assert.equal(rows[0].id, history.id);
 assert.equal(rows[0].time, conversationTimeLabel(activityAt, now));
});

test('pending choice questions show the first two feed actions and keep remaining choices in chat', () => {
 const task = {id:'task',runId:'run',decisionId:'decision',title:'Dinner',subtitle:'',chosenOption:'',originalContext:'',category:'travel',status:'needs_approval',actionId:'question-action',updatedAt:'2026-10-01T20:00:00Z',questionRequest:{questions:[{id:'q',question:'Which time?',answerType:'single_choice',options:[{id:'a',label:'6 PM'},{id:'b',label:'7 PM'},{id:'c',label:'8 PM'}]}]}} as RunningTask;
 const row=conversationItems([], [task], [])[0];
 assert.equal(row.proactive?.body,'Which time?');
 assert.equal(row.proactive?.option?.id,'a');assert.equal(row.proactive?.alternative?.id,'b');
 assert.equal(row.feedQuestion?.moreOptions,true);
 task.questionRequest!.questions[0].answerType='multiple_choice';
 assert.equal(conversationItems([], [task], [])[0].feedQuestion?.multiple,true);
 task.status='running';assert.equal(conversationItems([], [task], [])[0].proactive,undefined);
});

test('a received reply replaces an older tool label before the completion snapshot arrives', () => {
 const task: RunningTask = { id:'task',runId:'run',decisionId:'trip',category:'travel',title:'Trip',subtitle:'Reading reservations',status:'running',chosenOption:'Book it',originalContext:'',updatedAt:'2026-10-05T14:00:01Z',activityAt:'2026-10-05T14:00:01Z',activity:{label:'Reading reservations',icon:'browser'} };
 const messages = {'decision:trip':{kind:'agent' as const,text:'Your table is booked.',createdAt:'2026-10-05T14:00:02Z'}};
 const row=conversationItems([], [task], [], undefined, {}, messages)[0];
 assert.equal(row.line,'Your table is booked.');assert.equal(row.activity,undefined);
 const resumed=conversationItems([], [{...task,activityAt:'2026-10-05T14:00:03Z'}], [], undefined, {}, messages)[0];
 assert.equal(resumed.activity?.label,'Reading reservations');
});
