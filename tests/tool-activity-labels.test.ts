import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { TOOL_ACTIVITY_LABELS, APPLE_ACTIVITY_LABELS } from '../lib/harness/tool-activity-labels';
import { appleOperations } from '../lib/apple/catalog';
import { conversationWorkLabel } from '../lib/harness/thread';
import { activityLabel } from '../lib/harness/tool-activity-labels';
import type { AgentRunSnapshot } from '../lib/harness/types';

test('every registered execution tool has a plain-language activity label', () => {
  const registered = new Set<string>();
  // Parse all lib files, including single-tool factories, Apple, pauses,
  // schedules and response tools rather than maintaining a second tool list.
  for (const file of readdirSync('lib', { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.ts'))) {
    const source = ts.createSourceFile(file, readFileSync(`lib/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)
        && /^(tool|create\w*Tool)$/.test(node.initializer.expression.text)
        && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) registered.add(node.name.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(registered.size > 45, 'must inspect the full tool registry');
  for (const name of registered) assert.ok(Object.hasOwn(TOOL_ACTIVITY_LABELS, name), `Missing explicit activity label: ${name}`);
  assert.equal(activityLabel('gmail_create_draft'), 'Drafting email');
  assert.equal(activityLabel('web_search_exa'), 'Searching the web');
  assert.equal(activityLabel('sandbox_run'), 'Writing and running code');
  assert.equal(activityLabel('gmail_read_message'), 'Reading email');
  assert.equal(activityLabel('calendar_search_events'), 'Checking your calendar');
  assert.equal(activityLabel('browser_type', { purpose: 'secret text', text: 'password' }), 'Filling in details');
});

test('activity follows the latest tool between calls and clears on pause or completion', () => {
  const snapshot = { status: 'running', metadata: { taskWorkStarted: true, currentActivityActionId: 'search' }, actions: [
    { id: 'search', toolName: 'web_search_exa', input: {}, status: 'approved' },
    { id: 'draft', toolName: 'gmail_create_draft', input: {}, status: 'approved' },
  ] } as unknown as AgentRunSnapshot;
  assert.equal(conversationWorkLabel(snapshot), 'Searching the web');
  snapshot.metadata.currentActivityActionId = 'draft';
  assert.equal(conversationWorkLabel(snapshot), 'Drafting email');
  snapshot.actions[1].status = 'executed';
  assert.equal(conversationWorkLabel(snapshot), 'Drafting email');
  snapshot.status = 'awaiting_approval';
  assert.equal(conversationWorkLabel(snapshot), null);
  snapshot.status = 'done';
  assert.equal(conversationWorkLabel(snapshot), null);
});

test('every Apple operation has an explicit operation-specific label', () => {
  assert.deepEqual(Object.keys(APPLE_ACTIVITY_LABELS).sort(), [...appleOperations].sort());
  for (const operation of appleOperations) {
    assert.equal(activityLabel('apple_device', { operation }), APPLE_ACTIVITY_LABELS[operation]);
  }
  assert.equal(activityLabel('apple_device', { operation: 'weather.forecast' }), 'Checking the weather');
  assert.equal(activityLabel('remember'), 'Remembering your preferences');
});

test('connector labels name the app without exposing arguments', () => {
  assert.equal(activityLabel('composio__GMAIL_SEND_EMAIL', { body: 'private text' }), 'Using Gmail');
  assert.equal(activityLabel('composio__GOOGLECALENDAR_CREATE_EVENT'), 'Using Google Calendar');
  assert.equal(activityLabel('connector_execute', { toolSlug: 'TWITTER_USER_LOOKUP', arguments: { text: 'private' } }), 'Using X');
  assert.equal(activityLabel('connector_execute', { toolSlug: 'NOTION_FETCH_DATA' }), 'Using Notion');
  assert.equal(activityLabel('connector_execute', { toolSlug: 'GITHUB_LIST_ISSUES' }), 'Using GitHub');
  assert.equal(activityLabel('connector_execute'), 'Using a connected app');
  assert.equal(activityLabel('toString'), 'Working on it');
});

test('fast tools without action records remain visible between calls and typing takes precedence', async () => {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const { MemoryRunStore } = await import('../lib/harness/store');
  const { steerableTools } = await import('../lib/harness/steering');
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'activity@test.invalid', decisionId: null, request: 'Search and remind me', title: 'Reminder', category: 'other', metadata: { taskWorkStarted: true } });
  await store.updateRun(run.id, { status: 'running' });
  const label = async () => conversationWorkLabel((await store.getSnapshot(run.id))!);
  assert.equal(await label(), 'Thinking');
  const tools = steerableTools({
    web_search_exa: tool({ inputSchema: z.object({}), execute: async () => { assert.equal(await label(), 'Searching the web'); return {}; } }),
    apple_device: tool({ inputSchema: z.object({ operation: z.string() }), execute: async () => { assert.equal(await label(), 'Creating a reminder'); return {}; } }),
  }, store, run.id);
  await tools.web_search_exa.execute!({}, { toolCallId: 'search', messages: [], context: {} });
  assert.equal(await label(), 'Searching the web');
  await tools.apple_device.execute!({ operation: 'reminders.create' }, { toolCallId: 'remind', messages: [], context: {} });
  assert.equal(await label(), 'Creating a reminder');
  assert.equal((await store.getSnapshot(run.id))!.actions.length, 0);
  const { conversationActivityAt } = await import('../lib/harness/thread');
  const activityAt = conversationActivityAt((await store.getSnapshot(run.id))!);
  assert.ok(activityAt);
  await store.updateRunMetadata(run.id, { toolActivity: null });
  assert.equal(conversationActivityAt((await store.getSnapshot(run.id))!), activityAt);
  await store.updateRunMetadata(run.id, { toolActivity: { label: 'Creating a reminder', icon: 'reminder' } });
  await store.updateRunMetadata(run.id, { replyTyping: true });
  assert.equal(await label(), null);
  await store.updateRunMetadata(run.id, { replyTyping: false });
  await store.updateRun(run.id, { status: 'paused' });
  assert.equal(await label(), null);
});


test('every tool and Apple operation has an explicit renderable activity icon', async () => {
 const { TOOL_ACTIVITY_ICONS, APPLE_ACTIVITY_ICONS, ACTIVITY_ICONS, activityIcon } = await import('../lib/harness/tool-activity-icons');
 assert.deepEqual(Object.keys(TOOL_ACTIVITY_ICONS).sort(), Object.keys(TOOL_ACTIVITY_LABELS).sort());
 assert.deepEqual(Object.keys(APPLE_ACTIVITY_ICONS).sort(), [...appleOperations].sort());
 for (const icon of [...Object.values(TOOL_ACTIVITY_ICONS), ...Object.values(APPLE_ACTIVITY_ICONS)]) {
  assert.ok(ACTIVITY_ICONS[icon].path); assert.ok(ACTIVITY_ICONS[icon].symbol);
 }
 assert.equal(activityIcon('browser_open'), 'browser');
 assert.equal(activityIcon('sandbox_run'), 'code');
 assert.equal(activityIcon('apple_device', {operation:'maps.directions'}), 'map');
 assert.equal(activityIcon('apple_device', {operation:'music.play'}), 'music');
 assert.equal(activityIcon('composio__UNKNOWN_TOOL'), 'connection');
 const native = readFileSync('ios/DecisionFeed/Web/WebCoordinator.swift', 'utf8');
 const nativeNames = native.match(/static let names = \[([^\]]+)\]/)![1].match(/"([^"]+)"/g)!.map(value => JSON.parse(value));
 assert.deepEqual(nativeNames.sort(), Object.values(ACTIVITY_ICONS).map(icon => icon.symbol).sort(), 'native feed and chat must cover the entire shared symbol registry');
});

test('activity label and icon stay paired across tool completion and typing', async () => {
 const { conversationWorkActivity } = await import('../lib/harness/thread');
 const snapshot = {status:'running', metadata:{toolActivity:{label:'Writing and running code',icon:'code'},currentActivityActionId:'old'},actions:[{id:'old',toolName:'browser_open',input:{}}]} as unknown as AgentRunSnapshot;
 assert.deepEqual(conversationWorkActivity(snapshot), {label:'Writing and running code',icon:'code'});
 snapshot.metadata.replyTyping = true;
 assert.deepEqual(conversationWorkActivity(snapshot), {label:'Typing',icon:'typing'});
 snapshot.status='done';
 assert.equal(conversationWorkActivity(snapshot), null);
});

test('a new reply resets previous-turn tool activity before the next model call', async () => {
 const { MemoryRunStore } = await import('../lib/harness/store');
 const { appendConversationReply } = await import('../lib/harness/conversation-reply');
 const { conversationWorkActivity } = await import('../lib/harness/thread');
 const store = new MemoryRunStore();
 const run = await store.createRun({ userId:'activity-reset@test.invalid', decisionId:null, title:'Photos', request:'Send the route', category:'other', metadata:{toolActivity:{label:'Preparing photos',icon:'photo'},taskWorkStarted:true,replyTyping:true,currentActivityActionId:'old',toolActivityMessageId:'old-message'} });
 await store.updateRun(run.id, {status:'done'});
 assert.equal(await appendConversationReply(store, run.id, 'What about tomorrow?'), 'started');
 assert.deepEqual(conversationWorkActivity((await store.getSnapshot(run.id))!), {label:'Thinking',icon:'thinking'});
 assert.equal((await store.getRun(run.id))!.metadata.currentActivityActionId, null);
 await store.updateRunMetadata(run.id, {toolActivity:{label:'Reading email',icon:'email'},replyTyping:false});
 assert.deepEqual(conversationWorkActivity((await store.getSnapshot(run.id))!), {label:'Reading email',icon:'email'});
 assert.equal(await appendConversationReply(store, run.id, 'Actually Friday'), 'steering');
 await store.updateRunMetadata(run.id, {replyTyping:true});
 assert.deepEqual(conversationWorkActivity((await store.getSnapshot(run.id))!), {label:'Thinking',icon:'thinking'});
 assert.equal(conversationWorkLabel((await store.getSnapshot(run.id))!), 'Thinking');
 // An old in-flight tool may finish after Send, but cannot label the new turn.
 await store.updateRunMetadata(run.id, {toolActivity:{label:'Reading email',icon:'email',finishedAt:Date.now()}});
 assert.deepEqual(conversationWorkActivity((await store.getSnapshot(run.id))!), {label:'Thinking',icon:'thinking'});
 await store.consumeSteering(run.id);
 assert.deepEqual(conversationWorkActivity((await store.getSnapshot(run.id))!), {label:'Thinking',icon:'thinking'});
 await store.updateRun(run.id, {status:'done'});
 await store.updateRunMetadata(run.id, {toolActivity:{label:'Preparing photos',icon:'photo'},replyTyping:true});
 await store.acceptNotificationReply({owner:run.userId,runId:run.id,eventId:crypto.randomUUID(),text:'And Saturday?'});
 assert.deepEqual(conversationWorkActivity((await store.getSnapshot(run.id))!), {label:'Thinking',icon:'thinking'});
});

test('confetti randomly selects one of its two playful activity labels', () => {
  const previous = Math.random;
  try {
    Math.random = () => 0.2;
    assert.equal(activityLabel('easteregg', {effect:'confetti'}), 'Activating superpowers');
    Math.random = () => 0.8;
    assert.equal(activityLabel('easteregg', {effect:'confetti'}), 'Making it rain');
  } finally { Math.random = previous; }
});

test("new easter eggs each have a playful activity label", () => {
  assert.equal(activityLabel("easteregg", {effect:"disco"}), "Taking the dance floor");
  assert.equal(activityLabel("easteregg", {effect:"snow"}), "Changing the forecast");
  assert.equal(activityLabel("easteregg", {effect:"flip"}), "Attempting something unnecessary");
});

test('answered questions show planning until the next tool starts', () => {
  const snapshot = { status: 'running', metadata: { taskWorkStarted: true, currentActivityActionId: 'question', toolActivity: { label: 'Asking you a question', icon: 'question' } }, actions: [
    { id: 'question', toolName: 'ask_questions', input: {}, status: 'executed' },
    { id: 'search', toolName: 'web_search_exa', input: {}, status: 'approved' },
  ] } as unknown as AgentRunSnapshot;
  assert.equal(conversationWorkLabel(snapshot), 'Planning next moves');
  snapshot.metadata.currentActivityActionId = 'search';
  snapshot.metadata.toolActivity = { label: 'Searching the web', icon: 'search' };
  assert.equal(conversationWorkLabel(snapshot), 'Searching the web');
  snapshot.status = 'awaiting_approval';
  assert.equal(conversationWorkLabel(snapshot), null);
});
