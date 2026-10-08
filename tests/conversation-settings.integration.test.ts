import { notificationConversation } from "../lib/push-notifications";
import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { ConversationSettingsError, getConversationMessages, getConversationSettings, updateConversationSettings } from '../lib/conversation-settings-store';
import { getWorkspaceState, putWorkspaceState } from '../lib/workspace-state';
import type { WorkspacePreferences, WorkspaceStateData } from '../lib/types';
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
test('conversation actions persist with account isolation and survive concurrent stale workspace saves', { skip: !url }, async () => {
  const admin = postgres(url!, { onnotice: () => {} });
  const name = `conversation_menu_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin.unsafe(`create schema ${name}`);
  const client = postgres(url!, { prepare: false, connection: { search_path: name }, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const state = { decisions: [{ id: 'chat', title: 'Generated', category: 'travel' }], tasks: [], history: [], discardedDecisionIds: [] } as unknown as WorkspaceStateData;
  const preferences = { appearance: 'system', modelSettings: { provider: 'openai', modelId: 'test', reasoningEffort: 'medium' } } as WorkspacePreferences;
  try {
    await client`create table workspace_states(owner_email text primary key,state_json jsonb not null,preferences_json jsonb not null,version integer not null,created_at timestamptz default now(),updated_at timestamptz default now())`;
    await client`create table agent_runs(id uuid primary key,user_id text,decision_id text,title text,category text,metadata jsonb default '{}',request text default '',status text default 'done',updated_at timestamptz default now(),created_at timestamptz default now())`;
    await client`create table agent_actions(id uuid primary key,run_id uuid,tool_name text,status text,input jsonb,preview text,created_at timestamptz default now())`;
    assert.equal((await putWorkspaceState('owner@test.invalid', state, preferences, 0, db)).conflict, false);
    await putWorkspaceState('other@test.invalid', { ...state, decisions: [] }, preferences, 0, db);
    await assert.rejects(updateConversationSettings('other@test.invalid', { key: 'decision:chat', action: 'archive' }, db), (error: unknown) => error instanceof ConversationSettingsError && error.status === 404);
    await Promise.all([
      updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'rename', title: 'My trip' }, db),
      updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'pin' }, db),
    ]);
    let saved = await getConversationSettings('owner@test.invalid', db);
    assert.equal(saved['decision:chat'].title, 'My trip'); assert.ok(saved['decision:chat'].pinnedAt);
    const stale = await putWorkspaceState('owner@test.invalid', state, preferences, 1, db);
    assert.equal(stale.conflict, true);
    const remote = await getWorkspaceState('owner@test.invalid', db);
    await putWorkspaceState('owner@test.invalid', state, preferences, remote.version, db);
    saved = await getConversationSettings('owner@test.invalid', db);
    assert.equal(saved['decision:chat'].title, 'My trip'); assert.ok(saved['decision:chat'].pinnedAt);
    await updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'archive' }, db);
    saved = await getConversationSettings('owner@test.invalid', db);
    assert.equal(saved['decision:chat'].archived, true); assert.equal(saved['decision:chat'].pinnedAt, null);
    await updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'unarchive' }, db);
    assert.equal((await getConversationSettings('owner@test.invalid', db))['decision:chat'].archived, false);
    assert.deepEqual(await getConversationSettings('other@test.invalid', db), {});
    assert.equal((await getWorkspaceState('owner@test.invalid', db)).state.decisions.length, 1, 'Archive never deletes the conversation');
    await client`create table agent_messages(id uuid primary key,run_id uuid,seq integer,message jsonb,created_at timestamptz)`;
    const run = crypto.randomUUID(), otherRun = crypto.randomUUID(), continuation = crypto.randomUUID();
    await client`insert into agent_runs(id,user_id,decision_id) values (${run},'owner@test.invalid','chat'),(${otherRun},'other@test.invalid','chat'),(${continuation},'owner@test.invalid','chat')`;
    for (const id of [`run-completed:${run}:event`, `run-attention:${continuation}:event`, 'chat']) {
      assert.deepEqual(await notificationConversation({ ownerEmail: 'owner@test.invalid', decisionId: id, title: 'Task completed', subtitle: 'Old title' }, db),
        { conversationId: 'decision:chat', title: 'My trip', archived: false, stale: false });
    }
    assert.deepEqual(await notificationConversation({ ownerEmail: 'other@test.invalid', decisionId: `run-completed:${run}`, title: 'Fallback', subtitle: '' }, db),
      { conversationId: `run:${run}`, title: 'Fallback', archived: false, stale: false });
    const add = (runId: string, seq: number, message: unknown, at: string) => client`insert into agent_messages values (${crypto.randomUUID()},${runId},${seq},${JSON.stringify(message)}::jsonb,${at})`;
    await add(run, 1, { role: 'user', content: '[runtime] PRIVATE CONTEXT' }, '2026-08-24T10:00:00Z');
    await add(run, 2, { role: 'assistant', content: 'First answer' }, '2026-08-24T11:00:00Z');
    await add(continuation, 1, { role: 'assistant', content: [{ type: 'text', text: 'Latest ' }, { type: 'tool-call', input: { secret: 'PRIVATE' } }, { type: 'text', text: 'answer' }] }, '2026-08-24T12:00:00Z');
    await add(continuation, 2, { role: 'assistant', content: [{ type: 'tool-call', input: { secret: 'PRIVATE' } }] }, '2026-08-24T13:00:00Z');
    await add(otherRun, 1, { role: 'assistant', content: 'Other account answer' }, '2026-08-24T14:00:00Z');
    assert.deepEqual(await getConversationMessages('owner@test.invalid', db), { 'decision:chat': { kind: 'agent', text: 'Latest answer', unreadCount: 2, createdAt: '2026-08-24T12:00:00.000Z', incomingAt: '2026-08-24T12:00:00.000Z' } });
    assert.equal((await getConversationMessages('other@test.invalid', db))['decision:chat'].text, 'Other account answer');
    await updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'read', through: '2026-08-24T12:00:00Z' }, db);
    await updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'read', through: '2026-08-24T11:00:00Z' }, db);
    assert.equal((await getConversationMessages('owner@test.invalid', db))['decision:chat'].unreadCount, 0);
    saved = await getConversationSettings('owner@test.invalid', db);
    assert.equal(saved['decision:chat'].lastReadAt, '2026-08-24T12:00:00.000Z');
    assert.equal(saved['decision:chat'].title, 'My trip');
    const afterRead = await getWorkspaceState('owner@test.invalid', db);
    await putWorkspaceState('owner@test.invalid', state, preferences, afterRead.version, db);
    assert.equal((await getConversationSettings('owner@test.invalid', db))['decision:chat'].lastReadAt, '2026-08-24T12:00:00.000Z');
    assert.equal((await getConversationSettings('other@test.invalid', db))['decision:chat'], undefined);
    await updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'unread' }, db);
    const afterUnread = await getWorkspaceState('owner@test.invalid', db);
    await putWorkspaceState('owner@test.invalid', state, preferences, afterUnread.version, db);
    assert.equal((await getConversationSettings('owner@test.invalid', db))['decision:chat'].markedUnread, true);
    await updateConversationSettings('owner@test.invalid', { key: 'decision:chat', action: 'read', through: '2026-08-24T12:00:00Z' }, db);
    assert.equal((await getConversationSettings('owner@test.invalid', db))['decision:chat'].markedUnread, false);
    await add(continuation, 3, { role: 'user', content: [{ type: 'text', text: 'Actually eight please' }, { type: 'text', text: '[attachment context] PRIVATE' }, { type: 'text', text: '[reply context] PRIVATE' }] }, '2026-08-24T14:30:00Z');
    const outgoing = (await getConversationMessages('owner@test.invalid', db))['decision:chat'];
    assert.equal(outgoing.kind, 'user'); assert.equal(outgoing.text, 'Actually eight please');
    assert.equal(outgoing.unreadCount, 0); assert.equal(outgoing.incomingAt, '2026-08-24T12:00:00.000Z');
    await add(run, 3, { role: 'assistant', content: '[runtime] PRIVATE reaction context', providerOptions: { wdyt: { reaction: { eventId: crypto.randomUUID(), messageId: 'user-message', emoji: '👍' } } } }, '2026-08-24T15:00:00Z');
    const reacted = (await getConversationMessages('owner@test.invalid', db))['decision:chat'];
    assert.equal(reacted.text, 'reacted 👍');
    assert.equal(reacted.reaction, true);
    assert.equal(reacted.unreadCount, 1);
    assert.doesNotMatch(reacted.text, /runtime|PRIVATE/);
    const queued = { id: crypto.randomUUID(), runId: continuation, seq: 0, message: { role: 'user', content: 'One more thing' }, createdAt: '2026-08-24T16:00:00Z' };
    await client`update agent_runs set metadata=${JSON.stringify({ pendingSteering: [queued] })}::jsonb where id=${continuation}`;
    const pending = (await getConversationMessages('owner@test.invalid', db))['decision:chat'];
    assert.equal(pending.text, 'One more thing'); assert.equal(pending.kind, 'user'); assert.equal(pending.unreadCount, 1);
    await add(continuation, 4, { role: 'user', content: '[runtime] PRIVATE latest context' }, '2026-08-24T17:00:00Z');
    assert.equal((await getConversationMessages('owner@test.invalid', db))['decision:chat'].text, 'One more thing');
    const reaction = { role: 'user', content: '[runtime] PRIVATE reaction context', providerOptions: { wdyt: { reaction: { eventId: crypto.randomUUID(), messageId: 'assistant-message', emoji: '❤️' } } } };
    const queuedReaction = { ...queued, id: crypto.randomUUID(), message: reaction, createdAt: '2026-08-24T18:00:00Z' };
    await client`update agent_runs set metadata=${JSON.stringify({ pendingSteering: [queuedReaction] })}::jsonb where id=${continuation}`;
    const pendingReaction = (await getConversationMessages('owner@test.invalid', db))['decision:chat'];
    assert.equal(pendingReaction.text, 'You reacted ❤️');
    assert.equal(pendingReaction.reaction, true);
    assert.equal(pendingReaction.unreadCount, 1);
    assert.equal(pendingReaction.incomingAt, reacted.incomingAt);
    await client`insert into agent_messages values (${queuedReaction.id},${continuation},5,${JSON.stringify(reaction)}::jsonb,${queuedReaction.createdAt})`;
    assert.deepEqual((await getConversationMessages('owner@test.invalid', db))['decision:chat'], pendingReaction);
    await add(continuation, 6, { ...reaction, providerOptions: { wdyt: { reaction: { ...reaction.providerOptions.wdyt.reaction, emoji: null } } } }, '2026-08-24T19:00:00Z');
    const removed = (await getConversationMessages('owner@test.invalid', db))['decision:chat'];
    assert.equal(removed.text, 'You removed a reaction');
    assert.equal(removed.createdAt, '2026-08-24T19:00:00.000Z');
    assert.equal(removed.unreadCount, 1);
    const seeded = crypto.randomUUID();
    await client`insert into agent_runs(id,user_id,decision_id,request,metadata,created_at) values (${seeded},'owner@test.invalid','new-chat','Safe request',${JSON.stringify({ userMessage: 'Visible opening' })}::jsonb,'2026-08-24T18:00:00Z')`;
    await add(seeded, 1, { role: 'user', content: 'Visible opening\nPRIVATE system context' }, '2026-08-24T18:00:01Z');
    const opening = (await getConversationMessages('owner@test.invalid', db))['decision:new-chat'];
    assert.equal(opening.text, 'Visible opening'); assert.equal(opening.unreadCount, 0);

  } finally { await client.end(); await admin.unsafe(`drop schema ${name} cascade`); await admin.end(); }
});
