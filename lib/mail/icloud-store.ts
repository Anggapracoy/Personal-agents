import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { encryptSecret, decryptSecret } from '../harness/secrets';
import { iCloudCredentials, verifyICloudMail, iCloudAuthRejected, ICloudConnectionError } from './icloud-client';
export type ICloudAccount = { id: string; email: string; enabled: boolean; needsReconnect: boolean };
export async function listICloudAccounts(owner: string, db = getDb()): Promise<ICloudAccount[]> {
  return db.execute<ICloudAccount>(sql`select id,email,enabled,reconnect_required_at is not null as "needsReconnect" from connected_icloud_mail_accounts where owner_email=${owner.trim().toLowerCase()} order by created_at`);
}
export async function connectICloudAccount(owner: string, email: string, password: string, options: { db?: ReturnType<typeof getDb>; verify?: typeof verifyICloudMail } = {}) {
  const db = options.db ?? getDb();
  const credentials = iCloudCredentials(email, password);
  try { await (options.verify ?? verifyICloudMail)(credentials.email, credentials.password); }
  catch (error) { throw new ICloudConnectionError(iCloudAuthRejected(error) ? 'Apple didn’t accept that address or app-specific password. Check both and try again.' : 'Couldn’t reach iCloud Mail. Try again in a moment.'); }
  const [row] = await db.execute<ICloudAccount>(sql`insert into connected_icloud_mail_accounts(owner_email,email,encrypted_password)
    values(${owner.trim().toLowerCase()},${credentials.email},${encryptSecret(credentials.password)})
    on conflict(owner_email,email) do update set encrypted_password=excluded.encrypted_password,enabled=true,reconnect_required_at=null,last_checked_at=null,updated_at=now()
    returning id,email,enabled,false as "needsReconnect"`);
  return row;
}
export async function iCloudSecret(owner: string, accountId: string, db = getDb()) {
  const [row] = await db.execute<{ id: string; email: string; encrypted_password: string }>(sql`select id,email,encrypted_password from connected_icloud_mail_accounts where owner_email=${owner.trim().toLowerCase()} and id=${accountId}::uuid and enabled=true and reconnect_required_at is null`);
  if (!row) throw new Error('Connect or reconnect this iCloud Mail account in Connected apps.');
  return { id: row.id, email: row.email, password: decryptSecret(row.encrypted_password), revision: row.encrypted_password };
}
export async function disconnectICloudAccount(owner: string, id: string, db = getDb()) { await db.execute(sql`delete from connected_icloud_mail_accounts where owner_email=${owner.trim().toLowerCase()} and id=${id}::uuid`); }
export async function recordICloudCheck(owner: string, id: string, error?: unknown, revision?: string, db = getDb()) {
  await db.execute(sql`update connected_icloud_mail_accounts set last_checked_at=now(),updated_at=now(),reconnect_required_at=case when ${iCloudAuthRejected(error)} then coalesce(reconnect_required_at,now()) else reconnect_required_at end where owner_email=${owner.trim().toLowerCase()} and id=${id}::uuid and (${revision ?? null}::text is null or encrypted_password=${revision ?? null})`);
}

export async function assertCurrentICloudAccount(owner: string, id: string, revision: string, db = getDb()) {
  const rows = await db.execute(sql`select 1 from connected_icloud_mail_accounts where owner_email=${owner.trim().toLowerCase()} and id=${id}::uuid and enabled=true and reconnect_required_at is null and encrypted_password=${revision}`);
  if (!rows.length) throw new Error('This iCloud Mail connection changed. Check Connected apps before continuing.');
}
