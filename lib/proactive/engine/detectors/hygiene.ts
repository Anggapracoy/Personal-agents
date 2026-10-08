import type { Decision } from '../../../types';
import { getWorkspaceState } from '../../../workspace-state';
import { engineOwners } from '../candidates';
import { removeDecisions } from '../store';
import { maintainTaskNudges } from './loops';

const UNDATED_TTL_MS = 14 * 86_400_000;

/** Undated suggestions nobody acted on stop cluttering Home after two weeks. */
export function expiredUndatedCards(decisions: Decision[], now = new Date()) {
  return decisions.filter(decision => decision.sourceType !== 'manual' && !decision.actionableUntil && !decision.activeRunId && !decision.result
    && now.getTime() - Date.parse(decision.createdAt) > UNDATED_TTL_MS);
}

/** DB-only expiry and nudges. Resolution belongs to changed-thread discovery. */
export async function cleanUpCards(now = new Date()) {
  let removed = 0;
  for (const { owner } of await engineOwners()) {
    const { state } = await getWorkspaceState(owner);
    removed += await removeDecisions(owner, expiredUndatedCards(state.decisions, now).map(d => d.id));
    await maintainTaskNudges(owner);
  }
  return { removed };
}
