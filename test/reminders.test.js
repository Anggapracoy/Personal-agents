import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReminder, ReminderStore, ReminderScheduler } from '../src/reminders.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const now = new Date('2026-10-09T10:00:00+07:00');

test('parses Indonesian tomorrow reminder', () => {
  const result = parseReminder('Ingatkan saya bayar listrik besok jam 9 pagi', now);
  assert.equal(result.task, 'bayar listrik');
  assert.equal(result.dueAt.getHours(), 9);
  assert.equal(result.dueAt.getDate(), 10);
});

test('requires approval before delivery and supports cancel', () => {
  const store = new ReminderStore();
  const item = store.create('u1', { task: 'telepon ibu', dueAt: new Date('2026-10-09T10:01:00+07:00'), timeZone: 'Asia/Jakarta' });
  assert.equal(store.due(new Date('2026-10-09T10:02:00+07:00')).length, 0);
  store.approve(item.id, 'u1');
  assert.equal(store.due(new Date('2026-10-09T10:02:00+07:00')).length, 1);
  store.cancel(item.id, 'u1');
  assert.equal(store.due(new Date('2026-10-09T10:02:00+07:00')).length, 0);
});

test('rejects cross-user approval', () => {
  const store = new ReminderStore();
  const item = store.create('u1', { task: 'bayar', dueAt: new Date(), timeZone: 'Asia/Jakarta' });
  assert.equal(store.approve(item.id, 'u2'), null);
});

test('persists reminders and scheduler delivery across store reload', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anakbuah-')), 'reminders.json');
  const dueAt = new Date('2026-10-09T10:01:00+07:00');
  const first = new ReminderStore(file);
  const item = first.create('u1', { task: 'bayar', dueAt, timeZone: 'Asia/Jakarta' });
  first.approve(item.id, 'u1');
  const second = new ReminderStore(file);
  const delivered = [];
  await new ReminderScheduler(second, x => delivered.push(x.id)).tick(new Date('2026-10-09T10:02:00+07:00'));
  assert.deepEqual(delivered, [item.id]);
  assert.equal(new ReminderStore(file).get(item.id).status, 'delivered');
});

test('keeps reminder pending when delivery fails', async () => {
  const store = new ReminderStore();
  const item = store.create('u1', { task: 'retry', dueAt: new Date('2026-10-09T10:01:00+07:00'), timeZone: 'Asia/Jakarta' });
  store.approve(item.id, 'u1');
  await new ReminderScheduler(store, async () => { throw new Error('provider down'); }).tick(new Date('2026-10-09T10:02:00+07:00'));
  assert.equal(store.get(item.id).status, 'pending');
  assert.equal(store.get(item.id).attempts, 1);
  assert.equal(store.due(new Date('2026-10-09T10:02:00+07:00')).length, 0);
});

test('moves repeatedly failing reminder to attention queue', () => {
  const store = new ReminderStore();
  const item = store.create('u1', { task: 'permanent failure', dueAt: new Date('2026-10-09T10:00:00+07:00'), timeZone: 'Asia/Jakarta' });
  store.approve(item.id, 'u1');
  for (let i = 0; i < 8; i++) store.retry(item.id, new Error('down'), new Date('2026-10-09T10:00:00+07:00'));
  assert.equal(store.get(item.id).status, 'failed_needs_attention');
  assert.equal(store.attentionCount(), 1);
  assert.equal(store.due(new Date('2026-10-09T12:00:00+07:00')).length, 0);
});

test('snoozes the latest delivered reminder', () => {
  const store = new ReminderStore();
  const item = store.create('u1', { task: 'telepon', dueAt: new Date('2026-10-09T10:00:00+07:00'), timeZone: 'Asia/Jakarta' });
  store.approve(item.id, 'u1'); store.deliver(item.id, new Date('2026-10-09T10:00:00+07:00'));
  const snoozed = store.snooze(store.latestDelivered('u1').id, 'u1', 60);
  assert.equal(snoozed.status, 'pending');
  assert.equal(snoozed.dueAt.getTime(), new Date('2026-10-09T11:00:00+07:00').getTime());
});

test('finds latest pending approval for text fallback', () => {
  const store = new ReminderStore();
  const item = store.create('u1', { task: 'fallback', dueAt: new Date(), timeZone: 'Asia/Jakarta' });
  assert.equal(store.latestPending('u1').id, item.id);
  store.approve(item.id, 'u1');
  assert.equal(store.latestPending('u1'), null);
});
