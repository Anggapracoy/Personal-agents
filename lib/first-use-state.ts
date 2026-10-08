import { sql } from 'drizzle-orm';
import { getDb } from '../db';
/** Completed results survive archiving; declined, failed and unfinished turns do not activate a user. */
export async function hasUsefulResult(owner: string, db = getDb()) {
 const [row] = await db.execute<{completed:boolean}>(sql`select exists(select 1 from agent_runs where user_id=${owner.trim().toLowerCase()} and status='done' and result->>'outcome'='completed' and coalesce(metadata->>'responseDisposition','') not in ('silent','reaction')) as completed`);
 return Boolean(row?.completed);
}
