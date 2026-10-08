import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMessageTimes, messageTimeLabel, conversationTimeLabel, sameMessageGroup } from '../app/message-time';
const message = (minute: number) => ({id:String(minute),kind:'user' as const,text:'hello',createdAt:new Date(2026,8,6,10,minute).toISOString()});
test('continuous exchanges keep one timestamp within a day, beyond an hour overall', () => {
  assert.equal(groupMessageTimes([message(0),message(40),message(80),message(120)]).filter(i=>i.kind==='timestamp').length,1);
});
test('an hour since the last message starts a new group', () => {
  assert.equal(groupMessageTimes([message(0),message(59),message(119)]).filter(i=>i.kind==='timestamp').length,2);
});
test('unknown historical times are omitted, with local Today and Yesterday labels', () => {
  assert.equal(groupMessageTimes([{id:'old',kind:'agent',text:'old'}]).length,1);
  const now = new Date(2026,8,6,13,43);
  assert.match(messageTimeLabel(now.toISOString(),now),/^Today /);
  assert.match(messageTimeLabel(new Date(2026,8,5,13,43).toISOString(),now),/^Yesterday /);
  assert.equal(messageTimeLabel('invalid',now),'');
});

test('crossing a local calendar day starts a new timestamp even in a short exchange', () => {
  const before = { ...message(0), createdAt: new Date(2026, 8, 6, 23, 59).toISOString() };
  const after = { ...message(1), createdAt: new Date(2026, 8, 7, 0, 1).toISOString() };
  assert.equal(groupMessageTimes([before, after]).filter(item => item.kind === 'timestamp').length, 2);
});
test('compact message groups stop at a new sender, a pause, a reaction or missing time', () => {
  const first = message(0), next = { ...message(0), id: 'next', createdAt: new Date(Date.parse(first.createdAt) + 20_000).toISOString() };
  assert.equal(sameMessageGroup(first, next), true);
  assert.equal(sameMessageGroup(first, { ...next, kind: 'agent' }), false);
  assert.equal(sameMessageGroup(first, message(1)), false);
  assert.equal(sameMessageGroup(first, { ...next, createdAt: undefined }), false);
});
test('list timestamps use calendar labels rather than elapsed counters', () => {
  const now = new Date(2026, 8, 13, 14, 20).getTime();
  assert.match(conversationTimeLabel(new Date(2026, 8, 13, 9, 15).toISOString(), now), /9:15/);
  assert.equal(conversationTimeLabel(new Date(2026, 8, 12, 9, 15).toISOString(), now), 'Yesterday');
  assert.equal(conversationTimeLabel('invalid', now), '');
});

test('document cards preserve normal spacing on both sides', () => {
  const text = message(0);
  const file = { ...text, id: 'file', files: [{id:'pdf',url:'/file.pdf',name:'file.pdf',mimeType:'application/pdf',description:'PDF'}] };
  assert.equal(sameMessageGroup(text, file), false);
  assert.equal(sameMessageGroup(file, text), false);
});

test('resumed calls start the evening timestamp group before the text reply', () => {
 const calls = ['20:08','20:10','20:12'].map((time, i) => ({ id: `call:${i}`, kind: 'call' as const, recipient: 'Restaurant', failed: false, createdAt: `2026-09-27T${time}:00Z` }));
 const rows = groupMessageTimes([{ ...message(0), createdAt: '2026-09-27T15:00:00Z' }, ...calls, { id: 'reply', kind: 'agent', text: 'Done', createdAt: '2026-09-27T20:13:00Z' }]);
 assert.deepEqual(rows.filter(item => item.kind === 'timestamp').map(item => item.createdAt), ['2026-09-27T15:00:00Z','2026-09-27T20:08:00Z']);
 assert.equal(rows.findIndex(item => item.id === 'call:0:time') + 1, rows.findIndex(item => item.id === 'call:0'));
});

test('structured output joins an assistant group and gets its own timestamp when standalone',()=>{
 const text={id:'text',kind:'agent' as const,text:'My recommendation',createdAt:'2026-10-02T12:00:00Z'};
 const blocks={id:'blocks',kind:'blocks' as const,blocks:[],followUpActions:[],createdAt:'2026-10-02T12:00:05Z'};
 assert.equal(sameMessageGroup(text,blocks),true);assert.equal(sameMessageGroup(blocks,text),false);
 assert.equal(groupMessageTimes([blocks])[0].kind,'timestamp');
});
