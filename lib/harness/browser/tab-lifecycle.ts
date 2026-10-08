import { sql } from "drizzle-orm";
import { getDb } from "../../../db";

// Keep recent finished pages available for inspection or a follow-up. Paused,
// queued and running tasks remain protected regardless of their age.
export async function inactiveBrowserTargets(userId: string): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const rows = await getDb().execute<{ id: string }>(sql`
    select id from agent_runs
    where user_id = ${userId.trim().toLowerCase()}
      and status in ('done', 'failed', 'cancelled')
      and updated_at < now() - interval '30 minutes'
  `);
  return rows.map(row => row.id);
}
