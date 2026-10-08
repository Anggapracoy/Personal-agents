import assert from 'node:assert/strict';
import test from 'node:test';
import { viewerHealth } from '../lib/harness/browser/viewer-health';

test('viewer recovery follows the creator connection, without reviving expired sessions or takeover', () => {
  const state = { expiresAt: 200, live: { run: { expiresAt: 190, control: false, transport: { key: 'page', token: 'first' } } } };
  assert.equal(viewerHealth(state, { page: 'first' }, 'run', false, 100), 'connected');
  assert.equal(viewerHealth(state, {}, 'run', false, 100), 'reconnect');
  assert.equal(viewerHealth(state, { page: 'replacement' }, 'run', false, 100), 'reconnect');
  assert.equal(viewerHealth(state, {}, 'run', true, 100), 'mode_changed');
  assert.equal(viewerHealth(state, {}, 'run', false, 191), 'unavailable');
  assert.equal(viewerHealth(state, {}, 'run', false, 201), 'unavailable');
  assert.equal(viewerHealth(state, {}, 'other-run', false, 100), 'unavailable');
});

test('agent connection replacement leaves viewer healthy; actual stream completion requests recovery', () => {
  const state={expiresAt:200,live:{run:{expiresAt:190,control:false,transport:{key:'viewer',token:'creator:0'}}}};
  assert.equal(viewerHealth(state,{input:'replacement',viewer:'creator:0'},'run',false,100),'connected');
  assert.equal(viewerHealth(state,{input:'replacement',viewer:'creator:1'},'run',false,100),'reconnect');
});

 test('expired takeover never prevents a fresh passive stream', () => {
  const state={expiresAt:300,live:{run:{expiresAt:150,control:true,transport:{key:'viewer',token:'old'}}}};
  assert.equal(viewerHealth(state,{viewer:'old'},'run',false,149),'mode_changed');
  assert.equal(viewerHealth(state,{viewer:'old'},'run',false,151),'unavailable');
  assert.equal(viewerHealth(state,{viewer:'old'},'run',true,151),'unavailable');
 });
