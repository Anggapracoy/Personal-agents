import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { sendICloudMessage } from '../lib/mail/icloud-client.ts';

// Exercise the real MIME/composition layer without opening any network connection.
test('iCloud sending preserves MIME headers, Unicode text and partial recipient receipts', async t => {
  const original = nodemailer.createTransport.bind(nodemailer);
  let mime, closed = false;
  t.mock.method(nodemailer, 'createTransport', options => {
    assert.equal(options.host, 'smtp.mail.me.com');
    assert.equal(options.requireTLS, true);
    assert.equal(options.auth.user, 'owner@icloud.com');
    return original({
      name: 'local-mime-test', version: '1.0.0',
      send(mail, callback) {
        const chunks = [];
        const stream = mail.message.createReadStream();
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('error', callback);
        stream.on('end', () => {
          mime = Buffer.concat(chunks);
          const recipients = mail.message.getEnvelope().to;
          callback(null, { messageId: mail.message.messageId(), accepted: [recipients[0]], rejected: [recipients[1]] });
        });
      },
      close() { closed = true; },
    });
  });
  const result = await sendICloudMessage('owner@icloud.com', 'local-test-only', {
    to: ['first@example.invalid', 'second@example.invalid'], subject: 'Montréal trip', body: 'Hello, Montréal!\nSecond line.',
    messageId: '<stable-id@example.invalid>', inReplyTo: '<parent@example.invalid>',
  });
  assert.deepEqual(result, {messageId:'<stable-id@example.invalid>', accepted:['first@example.invalid'], rejected:['second@example.invalid']});
  const parsed = await simpleParser(mime);
  assert.equal(parsed.subject, 'Montréal trip');
  assert.equal(parsed.messageId, '<stable-id@example.invalid>');
  assert.equal(parsed.inReplyTo, '<parent@example.invalid>');
  assert.equal(parsed.from.value[0].address, 'owner@icloud.com');
  assert.match(parsed.text, /Hello, Montréal!\nSecond line\./);
  assert.equal(mime.includes(Buffer.from('local-test-only')), false);
  assert.equal(closed, true);
});

test('Nodemailer rejection fields still produce an unambiguous all-rejected receipt', async t => {
  const original = nodemailer.createTransport.bind(nodemailer);
  let closed = false;
  t.mock.method(nodemailer, 'createTransport', () => original({
    name:'local-rejection-test', version:'1.0.0',
    send(_mail, callback) { callback(Object.assign(new Error('Rejected'), { code:'EENVELOPE', command:'RCPT TO', rejected:['first@example.invalid'] })); },
    close() { closed = true; },
  }));
  const result = await sendICloudMessage('owner@icloud.com', 'local-test-only', {
    to:['first@example.invalid'], subject:'Test', body:'Test', messageId:'<rejected@example.invalid>',
  });
  assert.deepEqual(result, {messageId:'<rejected@example.invalid>', accepted:[], rejected:['first@example.invalid']});
  assert.equal(closed, true);
});
