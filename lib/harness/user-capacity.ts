import { randomUUID } from 'node:crypto';
import { securityDatabase } from '../security-store';

export const MAX_CONCURRENT_USER_RUNS = 4;
const LEASE_MS = 120_000;
const memory = new Map<string, { token: string; expires: number }>();

/** Fenced leases bound execution across workers, including resumes and schedules. */
export async function acquireUserCapacity(email: string, database = securityDatabase(), now = () => Date.now()) {
  const owner = email.trim().toLowerCase();
  const token = randomUUID();
  for (let slot = 0; slot < MAX_CONCURRENT_USER_RUNS; slot++) {
    const key = `${owner}\0${slot}`;
    const acquired = database
      ? (await database`insert into agent_user_slots (owner_email, slot, token, expires_at)
          values (${owner}, ${slot}, ${token}, ${now() + LEASE_MS})
          on conflict (owner_email, slot) do update set token = excluded.token, expires_at = excluded.expires_at
          where agent_user_slots.expires_at <= ${now()} returning token`).length > 0
      : !memory.has(key) || memory.get(key)!.expires <= now();
    if (!acquired) continue;
    if (!database) memory.set(key, { token, expires: now() + LEASE_MS });
    let renewedAt = now();
    return {
      async assertOwned() {
        // An expired owner never revives its own lease, even before a replacement arrives.
        if (now() >= renewedAt + LEASE_MS) throw new Error('Task capacity lease expired.');
        if (now() - renewedAt < 20_000) return;
        if (database) {
          const rows = await database`update agent_user_slots set expires_at = ${now() + LEASE_MS}
            where owner_email = ${owner} and slot = ${slot} and token = ${token} and expires_at > ${now()} returning token`;
          if (!rows.length) throw new Error('Task capacity lease lost.');
        } else {
          const entry = memory.get(key);
          if (!entry || entry.token !== token || entry.expires <= now()) throw new Error('Task capacity lease lost.');
          entry.expires = now() + LEASE_MS;
        }
        renewedAt = now();
      },
      async release() {
        if (database) await database`delete from agent_user_slots where owner_email = ${owner} and slot = ${slot} and token = ${token}`;
        else if (memory.get(key)?.token === token) memory.delete(key);
      },
    };
  }
  return null;
}
