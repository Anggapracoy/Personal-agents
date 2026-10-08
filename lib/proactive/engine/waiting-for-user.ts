import { sql } from 'drizzle-orm';

/** A durable time/event wait has no user action to nudge for. */
export const waitingForUserSql = sql`(status='awaiting_approval' or (status='paused' and coalesce(metadata->'automaticPause', 'null'::jsonb) = 'null'::jsonb))`;
