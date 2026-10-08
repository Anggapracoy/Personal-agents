import assert from 'node:assert/strict';
import test from 'node:test';
import { appendSharedDraft } from '../app/shared-draft';

const file = { name: 'Invoice.txt', mimeType: 'text/plain', size: 5, dataBase64: Buffer.from('hello').toString('base64') };
test('sharing appends files and text to an unsent draft without changing existing attachments', async () => {
  const existing = new File(['before'], 'Existing.pdf', { type: 'application/pdf' });
  const result = appendSharedDraft({ text: 'Review these', files: [existing] }, { text: 'A receipt', url: 'https://example.com/receipt', files: [file] });
  assert.equal(result.text, 'Review these\n\nA receipt\n\nhttps://example.com/receipt');
  assert.equal(result.files[0], existing);
  assert.equal(result.files[1].name, 'Invoice.txt');
  assert.equal(result.files[1].type, 'text/plain');
  assert.equal(await result.files[1].text(), 'hello');
});
test('shared photos need no text, and a link already in shared text appears once', () => {
  const photo = appendSharedDraft({ text: '', files: [] }, { files: [{ ...file, name: 'Photo.jpg', mimeType: 'image/jpeg' }] });
  assert.equal(photo.text, '');
  assert.equal(photo.files[0].type, 'image/jpeg');
  assert.equal(appendSharedDraft({ text: '', files: [] }, { text: 'See https://example.com', url: 'https://example.com' }).text, 'See https://example.com');
});
test('failed shares preserve the existing draft and enforce actual byte and file limits', () => {
  const draft = { text: 'Keep this', files: [new File(['keep'], 'Keep.txt')] };
  assert.throws(() => appendSharedDraft(draft, { files: Array(6).fill(file) }), /6 files/);
  assert.throws(() => appendSharedDraft(draft, { files: [{ ...file, size: 1, dataBase64: Buffer.alloc(3 * 1024 * 1024).toString('base64') }] }), /3 MB/);
  assert.throws(() => appendSharedDraft(draft, { files: [{ ...file, dataBase64: '%%%invalid' }] }));
  assert.throws(() => appendSharedDraft(draft, { text: 'x'.repeat(4000) }), /too long/);
  assert.equal(draft.text, 'Keep this');
  assert.deepEqual(draft.files.map(file => file.name), ['Keep.txt']);
});
