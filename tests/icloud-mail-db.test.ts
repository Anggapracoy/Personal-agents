import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { connectICloudAccount, listICloudAccounts, iCloudSecret, disconnectICloudAccount, recordICloudCheck, assertCurrentICloudAccount } from '../lib/mail/icloud-store';

test('iCloud credentials are encrypted and account isolated; stale auth errors cannot revoke a replacement password', async () => {
  const client = new PGlite();
  const prior = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'local-fixture-secret-not-a-user-secret';
  const dialect = new PgDialect();
  const db = { execute: async (statement: any) => { const query = dialect.sqlToQuery(statement); return (await client.query(query.sql, query.params)).rows; } } as any;
  try {
    await client.exec(readFileSync('db/migrations/0034_icloud_mail.sql','utf8'));
    const first = await connectICloudAccount(' Owner@Test.Invalid ', 'fixture@icloud.com', 'abcd-efgh-ijkl-mnop', { db, verify: async () => {} });
    const secret = await iCloudSecret('owner@test.invalid', first.id, db);
    assert.equal(secret.password, 'abcd-efgh-ijkl-mnop');
    const row = (await client.query<{ encrypted_password: string }>('select encrypted_password from connected_icloud_mail_accounts')).rows[0];
    assert.ok(row.encrypted_password.startsWith('v1.')); assert.ok(!row.encrypted_password.includes(secret.password));
    assert.equal((await listICloudAccounts('other@test.invalid', db)).length, 0);
    await assert.rejects(iCloudSecret('other@test.invalid', first.id, db), /Connect or reconnect/);
    await disconnectICloudAccount('other@test.invalid', first.id, db);
    assert.equal((await listICloudAccounts('owner@test.invalid', db)).length, 1);
    await recordICloudCheck('owner@test.invalid', first.id, new Error('temporary timeout'), secret.revision, db);
    assert.equal((await listICloudAccounts('owner@test.invalid', db))[0].needsReconnect, false);
    await connectICloudAccount('owner@test.invalid', 'fixture@icloud.com', 'qrst-uvwx-yzab-cdef', { db, verify: async () => {} });
    await assert.rejects(assertCurrentICloudAccount("owner@test.invalid", first.id, secret.revision, db));
    await recordICloudCheck('owner@test.invalid', first.id, { authenticationFailed: true }, secret.revision, db);
    assert.equal((await listICloudAccounts('owner@test.invalid', db))[0].needsReconnect, false);
    const current = await iCloudSecret('owner@test.invalid', first.id, db);
    await recordICloudCheck('owner@test.invalid', first.id, { authenticationFailed: true }, current.revision, db);
    assert.equal((await listICloudAccounts('owner@test.invalid', db))[0].needsReconnect, true);
    await assert.rejects(iCloudSecret('owner@test.invalid', first.id, db));
    await disconnectICloudAccount('owner@test.invalid', first.id, db);
    assert.equal((await listICloudAccounts('owner@test.invalid', db)).length, 0);
  } finally { if (prior === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = prior; await client.close(); }
});
