import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IdempotencyStore } from '../src/idempotency.js';

test('persists webhook IDs across reload and caps entries', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anakbuah-idempotency-')), 'ids.json');
  const first = new IdempotencyStore(file, 2); first.add('a'); first.add('b'); first.add('c');
  const second = new IdempotencyStore(file, 2);
  assert.equal(second.has('a'), false); assert.equal(second.has('b'), true); assert.equal(second.has('c'), true);
});
