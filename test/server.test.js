import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

async function withServer(fn) {
  const server = createServer({ verifyToken: 'test-token' });
  await new Promise(resolve => server.listen(0, resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('verifies WhatsApp webhook and handles reminder payload', async () => {
  await withServer(async base => {
    const verification = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=abc`);
    assert.equal(await verification.text(), 'abc');
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: 'integration-1', from: '62812', type: 'text', timestamp: '1791507600', text: { body: 'Ingatkan saya bayar besok jam 9 pagi' } }] } }] }] };
    const response = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    assert.equal(body.received, true);
    assert.equal(body.reply.interactive.type, 'button');
    const duplicate = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal((await duplicate.json()).duplicate, true);
  });
});

test('health endpoint exposes capability status without secrets', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'anakbuah');
    assert.equal(Object.hasOwn(body, 'access_token'), false);
  });
});
