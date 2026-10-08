import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelMessage } from 'ai';
import { MemoryRunStore } from '../lib/harness/store';
import { persistPauseClosingMessages } from '../lib/pauses/closing-message';
const result = (value: Record<string, any>): ModelMessage[] => [{ role: 'tool', content: [{ type: 'tool-result', toolName: 'pause', toolCallId: 'wait-call', output: { type: 'json', value } }] }];
test('confirmed wait publishes one closing chat message, without marking the task completed', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'pause-close', decisionId: null, category: 'email', request: 'Ask and follow up', title: 'Email', metadata: {} });
  await store.updateRun(run.id, { status: 'paused' });
  const messages = result({ saved: true, paused: true, id: 'pause-one', closingMessage: 'Email sent. I’ll wait for their reply and check again in three days.' });
  await persistPauseClosingMessages(store, run.id, messages);
  await persistPauseClosingMessages(store, run.id, messages);
  const saved = await store.listMessages(run.id);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].message.content, 'Email sent. I’ll wait for their reply and check again in three days.');
  assert.equal((await store.getRun(run.id))?.status, 'paused');
});
test('failed saves and explicitly silent waits never publish a closing message', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'pause-quiet', decisionId: null, category: 'email', request: 'Quiet check', title: 'Email', metadata: {} });
  await persistPauseClosingMessages(store, run.id, result({ saved: false, paused: false, id: 'failed', closingMessage: 'Should not appear' }));
  await persistPauseClosingMessages(store, run.id, result({ saved: true, paused: true, id: 'silent', closingMessage: null }));
  assert.equal((await store.listMessages(run.id)).length, 0);
});
