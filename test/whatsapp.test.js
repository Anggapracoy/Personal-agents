import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseWebhook, verifySignature, verifyWebhook, approvalButtonMessage } from '../src/whatsapp.js';

test('parses WhatsApp text and interactive replies', () => {
  const base = { entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '62812', timestamp: '1791507600', type: 'text', text: { body: 'halo' } }] } }] }] };
  assert.equal(parseWebhook(base).text, 'halo');
  base.entry[0].changes[0].value.messages[0] = { id: 'm2', from: '62812', type: 'interactive', interactive: { button_reply: { id: 'approve:rem_1' } } };
  assert.equal(parseWebhook(base).text, 'approve:rem_1');
});

test('verifies webhook token and builds approval buttons', () => {
  assert.equal(verifyWebhook('subscribe', 'secret', 'challenge', 'secret'), 'challenge');
  assert.equal(verifyWebhook('subscribe', 'wrong', 'challenge', 'secret'), null);
  const message = approvalButtonMessage('62812', 'Confirm?', 'rem_1');
  assert.equal(message.interactive.action.buttons[0].reply.id, 'approve:rem_1');
});

test('verifies Meta webhook HMAC signature', () => {
  const body = '{"hello":"world"}';
  const signature = `sha256=${crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
  assert.equal(verifySignature(body, signature, 'app-secret'), true);
  assert.equal(verifySignature(body, `${signature}00`, 'app-secret'), false);
  assert.equal(verifySignature(body, undefined, 'app-secret'), false);
});
