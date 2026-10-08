import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMeetingProposal, MeetingProposalStore, parseMeetingRequest } from '../src/meetings.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('parses Indonesian meeting request', () => {
  const meeting = parseMeetingRequest('Jadwalkan meeting dengan Budi besok jam 10 sampai 11 pagi', new Date('2026-10-09T08:00:00+07:00'));
  assert.equal(meeting.title, 'Budi');
  assert.equal(meeting.start.getHours(), 10);
  assert.equal(meeting.end.getHours(), 11);
});

test('rejects backwards meeting interval and reports conflicts', () => {
  assert.equal(parseMeetingRequest('Buatkan meeting besok jam 11 sampai 10'), null);
  const meeting = parseMeetingRequest('Atur rapat dengan tim besok jam 10 sampai 11');
  assert.match(formatMeetingProposal(meeting, [{ id: 'busy' }]), /bentrok/);
});

test('persists meeting proposals across reload', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anakbuah-meeting-')), 'proposals.json');
  const first = new MeetingProposalStore(file); first.set('meeting_1', { userId: 'u1', createdAt: Date.now(), event: { summary: 'Test' } });
  assert.equal(new MeetingProposalStore(file).get('meeting_1').event.summary, 'Test');
  assert.equal(new MeetingProposalStore(file).delete('meeting_1'), true);
  assert.equal(new MeetingProposalStore(file).get('meeting_1'), null);
});

test('prunes expired meeting proposals', () => {
  const store = new MeetingProposalStore();
  store.set('old', { createdAt: 100, userId: 'u1' });
  store.set('new', { createdAt: 1000, userId: 'u1' });
  assert.equal(store.prune(500, 1200), 1);
  assert.equal(store.get('old'), null);
  assert.ok(store.get('new'));
});
