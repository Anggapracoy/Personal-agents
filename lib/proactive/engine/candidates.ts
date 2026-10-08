import type { Decision } from '../../types';
import { sql } from 'drizzle-orm';
import { getDb } from '../../../db';
import { callingEnabled } from '../../calling-policy';
import { isMorningAllowed, morningAccessPolicy } from '../morning-access';
import { type CandidateInput, type EngineDb } from './store';

/** v2 is enabled by the same feature policy as daily proactive ideas. */
export function proactiveEngineEnabled(ownerEmail: string, db?: EngineDb) {
  return isMorningAllowed(ownerEmail, db);
}

/** Onboarded accounts with v2, with their time zones. */
export async function engineOwners(db: EngineDb = getDb()) {
  const policy = await morningAccessPolicy(db);
  const rows = await db.execute<{ owner: string; timeZone: string }>(sql`
    select p.owner_email as owner, p.time_zone as "timeZone" from user_life_profiles p
    join mobile_user_states u on u.owner_email=p.owner_email and u.onboarding_completed=true`);
  return rows.filter(row => callingEnabled(policy, row.owner));
}

export function decisionCandidate(decision: Decision, notificationId: string, kind = 'decision'): CandidateInput {
  const expires = decision.actionableUntil ? new Date(decision.actionableUntil) : null;
  return {
    kind, dedupeKey: `decision:${notificationId}`,
    decisionId: decision.id, title: decision.title, body: decision.subtitle || 'Open Dash to review your options.',
    reason: decision.whyThisAppeared?.join(' ') || undefined, payload: { notificationId, category: decision.category },
    expiresAt: expires && Number.isFinite(expires.getTime()) ? expires : null,
  };
}
