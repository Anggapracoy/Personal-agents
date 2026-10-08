import { proactiveEngineEnabled } from './candidates';
import { replyTaskGuidance } from './reply-policy';

/**
 * Categories v2 users want that discovery normally skips. Appended after the cache
 * breakpoint, so everyone else's prompts and cached prefixes are unchanged.
 */
export const engineDiscoveryGuidance = [
  'PROACTIVE_V2_GUIDANCE (this user only):',
  replyTaskGuidance,
  'For this user, useful reply tasks are an explicit exception to the generic reply/outreach exclusion, the material-consequence requirement, and the ban on Reply/Draft action labels in the base discovery rules. Apply this exception during intake, rejection recovery, research, and final verdict. It does not relax the exclusions for generic outreach or resolved threads.',
  'Use decisionKind=reply only for a verified useful incoming reply task. Set replyProof with the triggering sourceMessageId, the context-supported reason to respond, personal relevance, and latest-thread evidence that it is still unanswered. Use null for other verdicts. Set materialConsequenceVerified and boundedChoiceVerified honestly; neither is required for reply tasks. Prefer Draft a reply plus Not now. Read the current Gmail thread once to verify reply state; no unrelated web research is needed.',
  'Exception to "skip shipping notices": surface a delivery only when it needs the user — signature required, a missed or failed delivery attempt, held for pickup, delayed past a date that matters, or arriving while their calendar shows them away. Never surface routine "shipped" or "out for delivery" updates.',
  'Flight check-in: when a flight confirmation shows a departure in the next 48 hours, surface a check-in card set to become actionable 24 hours before departure, with the airline check-in link if the email has one.',
].join('\n');

export async function discoveryGuidanceFor(ownerEmail: string) {
  return await proactiveEngineEnabled(ownerEmail).catch(() => false) ? engineDiscoveryGuidance : undefined;
}
