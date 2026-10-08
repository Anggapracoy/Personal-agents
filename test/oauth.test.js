import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptSecret, decryptSecret, TokenStore } from '../src/oauth.js';

test('encrypts tokens and decrypts only with key', () => {
  const encrypted = encryptSecret('refresh-token', 'test-key');
  assert.notEqual(encrypted, 'refresh-token');
  assert.equal(decryptSecret(encrypted, 'test-key'), 'refresh-token');
  assert.throws(() => decryptSecret(encrypted, 'wrong-key'));
});

test('persists encrypted user token', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anakbuah-oauth-')), 'tokens.json');
  const store = new TokenStore(file, 'test-key');
  store.set('user-1', { access_token: 'secret', expiry: 123 });
  assert.equal(new TokenStore(file, 'test-key').get('user-1').access_token, 'secret');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('secret'));
});

test('deletes user token on disconnect', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anakbuah-oauth-delete-')), 'tokens.json');
  const store = new TokenStore(file, 'test-key'); store.set('user-1', { access_token: 'secret' });
  assert.equal(store.delete('user-1'), true); assert.equal(store.get('user-1'), null); assert.equal(store.delete('user-1'), false);
});
