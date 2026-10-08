import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceMessageReceipt, readMessageReceipt } from '../lib/harness/message-receipt';

test('only provider acknowledgement advances delivery, then processing records read time', () => {
  const queued = { messageId: 'user-1' };
  assert.equal(advanceMessageReceipt(queued, 'start-step', '2026-09-06T12:00:00Z'), queued);
  assert.equal(advanceMessageReceipt(queued, 'error', '2026-09-06T12:00:00Z'), queued);
  const delivered = advanceMessageReceipt(queued, 'response.created', '2026-09-06T12:00:01Z');
  assert.equal(delivered.readAt, undefined);
  const read = advanceMessageReceipt(delivered, 'response.in_progress', '2026-09-06T12:00:02Z');
  assert.equal(read.deliveredAt, delivered.deliveredAt);
  assert.equal(read.readAt, '2026-09-06T12:00:02Z');
  assert.equal(advanceMessageReceipt(read, 'response.created', '2026-09-06T12:01:00Z'), read);
  assert.equal(advanceMessageReceipt(read, 'reasoning-start', '2026-09-06T12:01:00Z'), read);
});
test('providers without separate acceptance events can establish both on real output', () => {
  assert.deepEqual(advanceMessageReceipt({ messageId: 'u' }, 'text-start', '2026-09-06T12:00:00Z'), {messageId:'u', deliveredAt:'2026-09-06T12:00:00Z',readAt:'2026-09-06T12:00:00Z'});
  assert.equal(readMessageReceipt(null), null);
  assert.equal(readMessageReceipt({messageId:'u', readAt:'bad date'})?.readAt, undefined);
});

import { MemoryRunStore } from '../lib/harness/store';
import { threadItems } from '../lib/harness/thread';
test('receipt stays attached to its exact user turn and survives a reload', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({userId:'receipt-test',decisionId:null,category:'social',request:'Hello',title:'Hello',metadata:{}});
  const messages = await store.appendMessages(run.id,[{role:'user',content:'Hello'},{role:'assistant',content:'Hi'},{role:'user',content:'Hello'}]);
  await store.updateRunMetadata(run.id,{messageReceipt:{messageId:messages[2].id,deliveredAt:'2026-09-06T12:00:00Z',readAt:'2026-09-06T12:00:01Z'}});
  const items = threadItems((await store.getSnapshot(run.id))!,await store.listMessages(run.id));
  assert.equal(items[0].kind === 'user' && items[0].readAt, undefined);
  assert.equal(items[2].kind === 'user' && items[2].readAt,'2026-09-06T12:00:01Z');
});
