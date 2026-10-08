import test from 'node:test';
import assert from 'node:assert/strict';
import { replyAlreadyRepresented } from '../lib/proactive/engine/reply-policy';

test('scheduled scans do not recreate the same reply, but allow new requests and distinct follow-ups', () => {
  const current = {id:'billing',status:'feed' as const,title:'Browserless',sourceEmailIds:['reply-1'],sourceThreadIds:['thread-1'],optionLabels:['Draft a reply','Not now']};
  assert.equal(replyAlreadyRepresented('reply-1',[current]),true);
  assert.equal(replyAlreadyRepresented('reply-2',[current]),false,'new incoming request can qualify');
  assert.equal(replyAlreadyRepresented('reply-1',[{...current,status:'history',optionLabels:[]}]),true);
  assert.equal(replyAlreadyRepresented('reply-1',[{...current,status:'running',optionLabels:[]}]),true);
  assert.equal(replyAlreadyRepresented('reply-1',[{...current,optionLabels:['Pay invoice']}]),false,'unrelated action is not proof the reply is handled');
});
