import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { callingEnabled, callingPolicySchema, defaultCallingPolicy } from '../calling-policy';

export async function morningAccessPolicy(db: Pick<ReturnType<typeof getDb>, 'execute'> = getDb()) {
  const [row] = await db.execute<{ value: object; revision: number }>(sql`select value, revision from app_feature_flags where key='daily_proactive'`);
  return row ? callingPolicySchema.parse({ ...row.value, revision: Number(row.revision) }) : defaultCallingPolicy;
}
export async function isMorningAllowed(owner: string, db: Pick<ReturnType<typeof getDb>, 'execute'> = getDb()) {
  try { return callingEnabled(await morningAccessPolicy(db), owner); }
  catch { return false; }
}

/** Serialize publication with a feature-flag edit so a disable cannot race a commit. */
export async function proactivePublicationAllowed(owner:string,db:Pick<ReturnType<typeof getDb>,'execute'>) {
  await db.execute(sql`select key from app_feature_flags where key='daily_proactive' for share`);
  return isMorningAllowed(owner,db);
}
