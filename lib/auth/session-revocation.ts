import { randomUUID } from 'node:crypto';
import { securityDatabase } from '../security-store';

type SessionToken = { email?: string | null; jti?: string; iat?: number; sessionId?: unknown; sessionIssuedAt?: unknown };
const memory = new Map<string, number>();
export function newSessionIdentity() { return { sessionId: randomUUID(), sessionIssuedAt: Date.now() }; }
export function sessionIdentity(token: SessionToken) {
  return {
    sessionId: typeof token.sessionId === 'string' ? token.sessionId : token.jti,
    sessionIssuedAt: typeof token.sessionIssuedAt === 'number' ? token.sessionIssuedAt : (token.iat ?? 0) * 1000,
  };
}
function ownerKey(email: string) { return `owner:${email.trim().toLowerCase()}`; }
async function revoke(key: string, database = securityDatabase()) {
  const now = Date.now();
  if (!database) { memory.set(key, now); return; }
  await database`insert into auth_revocations (key, revoked_at) values (${key}, ${now})
    on conflict (key) do update set revoked_at = greatest(auth_revocations.revoked_at, excluded.revoked_at)`;
}
export async function revokeUserSessions(email: string, database = securityDatabase()) { await revoke(ownerKey(email), database); }
export async function revokeSession(token: SessionToken, database = securityDatabase()) {
  const { sessionId } = sessionIdentity(token);
  if (sessionId) await revoke(`session:${sessionId}`, database);
  else if (token.email) await revokeUserSessions(token.email, database);
}
export async function isSessionRevoked(token: SessionToken, database = securityDatabase()) {
  if (!token.email) return true;
  const identity = sessionIdentity(token);
  const keys = [ownerKey(token.email), `session:${identity.sessionId ?? ''}`];
  const records = database
    ? await database`select key, revoked_at from auth_revocations where key in ${database(keys)}`
    : keys.flatMap(key => memory.has(key) ? [{ key, revoked_at: memory.get(key)! }] : []);
  return records.some(row => row.key === keys[1] || identity.sessionIssuedAt <= Number(row.revoked_at));
}
