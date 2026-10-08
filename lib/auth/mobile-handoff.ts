import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb } from "../../db";
import { mobileAuthHandoffs } from "../../db/schema";
import { decryptSecret, encryptSecret } from "../harness/secrets";

const HANDOFF_LIFETIME_MS = 2 * 60 * 1000;

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function validMobileHandoffCode(code: string) {
  return /^[A-Za-z0-9_-]{40,64}$/.test(code);
}

export async function createMobileAuthHandoff(sessionToken: string) {
  const db = getDb();
  const code = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.delete(mobileAuthHandoffs).where(lt(mobileAuthHandoffs.expiresAt, now));
  await db.insert(mobileAuthHandoffs).values({
    codeHash: hashCode(code),
    encryptedSessionToken: encryptSecret(sessionToken),
    expiresAt: new Date(now.getTime() + HANDOFF_LIFETIME_MS),
  });
  return code;
}

export async function consumeMobileAuthHandoff(code: string) {
  if (!validMobileHandoffCode(code)) return null;
  const [record] = await getDb()
    .update(mobileAuthHandoffs)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(mobileAuthHandoffs.codeHash, hashCode(code)),
      isNull(mobileAuthHandoffs.consumedAt),
      gt(mobileAuthHandoffs.expiresAt, new Date()),
    ))
    .returning({ encryptedSessionToken: mobileAuthHandoffs.encryptedSessionToken });
  return record ? decryptSecret(record.encryptedSessionToken) : null;
}
