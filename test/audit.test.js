import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLog } from '../src/audit.js';

test('audit log redacts credential-like metadata', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anakbuah-audit-')), 'audit.jsonl');
  new AuditLog(file).record({ action: 'test', userId: 'u1', metadata: { token: 'secret', status: 'ok' } });
  const line = fs.readFileSync(file, 'utf8');
  assert.equal(line.includes('secret'), false); assert.equal(line.includes('"status":"ok"'), true);
});
