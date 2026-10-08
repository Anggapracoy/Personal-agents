import test from 'node:test';
import assert from 'node:assert/strict';
import { combineMessageResults } from '../lib/message-results';
import type { ThreadItem } from '../lib/harness/thread';
const options: ThreadItem = { id: 'options', kind: 'options', options: [
  { id: 'a', name: 'Gray pants', description: '$40', sourceUrl: 'https://example.com/pants', status: 'Available', recommended: true },
  { id: 'b', name: 'Same pants', description: '$40', sourceUrl: 'https://example.com/pants', status: 'Available', recommended: false },
  { id: 'c', name: 'Local alternative', description: 'Ask in store', sourceUrl: null, status: 'Unknown', recommended: false },
] };
test('legacy results fold into a single message without mutating cached items', () => {
  const original: ThreadItem[] = [{ id: 'reply', kind: 'agent', text: 'I recommend these.' }, options];
  const result = combineMessageResults(original);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'agent');
  if (result[0].kind !== 'agent') return;
  assert.equal(result[0].results?.length, 2);
  assert.equal(result[0].results?.[0].description, '$40');
  assert.equal(result[0].results?.[1].sourceUrl, null);
  assert.equal('results' in original[0], false);
  assert.deepEqual(combineMessageResults(result), result);
});
test('results never attach across a user turn or disappear without a final reply', () => {
  const result = combineMessageResults([{ id: 'old', kind: 'agent', text: 'Earlier' }, { id: 'user', kind: 'user', text: 'Find pants' }, options]);
  assert.equal(result.length, 3);
  assert.equal(result[2].kind, 'agent');
  assert.equal('results' in result[0], false);
});

test('result cards cannot rewrite commentary across tool work or a block reply', () => {
 for (const boundary of [{id:'tool',kind:'activity',tool:'web_search',label:'Searching'}, {id:'blocks',kind:'blocks',blocks:[],followUpActions:[]}] as ThreadItem[]) {
  const result=combineMessageResults([{id:'opening',kind:'agent',text:'I’ll find options.'},boundary,options]);
  assert.equal('results' in result[0],false);
  assert.equal(result.at(-1)?.kind,'agent');
 }
});
