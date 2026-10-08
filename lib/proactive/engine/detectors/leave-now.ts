import { sql } from 'drizzle-orm';
import { getDb } from '../../../../db';
import { getUsableGoogleConnections } from '../../../auth/google-connections';
import { fetchCalendarEventsInRange, type GoogleEvent } from '../../../google';
import { getLifeProfile } from '../../../life-profile';
import { sendSilentPush } from '../../../push-notifications';
import { engineDecision } from '../cards';
import { engineOwners, proactiveEngineEnabled } from '../candidates';
import { addCandidates, publishDecisions, type EngineDb } from '../store';

const BUFFER_MINUTES = 10;

/** Physical places only: video links and "TBD" are not somewhere to drive to. */
export function travelDestination(event: GoogleEvent) {
  const location = event.location?.trim() ?? '';
  if (!location || !event.start?.dateTime) return null;
  if (/^https?:\/\//i.test(location) || /\b(?:zoom|meet\.google|google meet|hangouts|teams|webex|facetime|online|virtual|remote|tbd|phone call|call)\b/i.test(location)) return null;
  return location.slice(0, 300);
}

/** When to leave, and whether the user is already late. */
export function leaveTiming(startsAt: Date, minutes: number, now = new Date()) {
  const leaveBy = new Date(startsAt.getTime() - (minutes + BUFFER_MINUTES) * 60_000);
  const arriveAt = new Date(now.getTime() + minutes * 60_000);
  return { leaveBy, late: arriveAt.getTime() > startsAt.getTime(), lateMinutes: Math.max(0, Math.round((arriveAt.getTime() - startsAt.getTime()) / 60_000)) };
}

function clockTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
}

/** Every five minutes: events with an address starting in 45–90 minutes get one travel-time check. */
export async function requestLeaveNowChecks(now = new Date(), db: EngineDb = getDb()) {
  let requested = 0;
  for (const { owner } of await engineOwners(db)) {
    const connections = await getUsableGoogleConnections(owner).catch(() => []);
    for (const connection of connections) {
      const events = await fetchCalendarEventsInRange(connection.accessToken, new Date(now.getTime() + 45 * 60_000).toISOString(), new Date(now.getTime() + 90 * 60_000).toISOString(), 20).catch(() => [] as GoogleEvent[]);
      for (const event of events) {
        const destination = travelDestination(event);
        if (!destination) continue;
        await db.execute(sql`insert into proactive_eta_checks (owner_email, event_key, event_title, destination, starts_at)
          values (${owner}, ${`${connection.id}:${event.id}:${event.start!.dateTime}`}, ${(event.summary || 'your event').slice(0, 120)}, ${destination}, ${event.start!.dateTime!}::timestamptz)
          on conflict (owner_email, event_key) do nothing`);
      }
    }
    requested += await retryEtaChecks(owner, now, db);
  }
  return { requested };
}

/** The phone answered with minutes. Buzz only when the user actually needs to leave soon. */
export async function answerEtaCheck(ownerEmail: string, checkId: string, minutes: number | null, now = new Date(), db: EngineDb = getDb()) {
  if (!await proactiveEngineEnabled(ownerEmail, db)) return { accepted: false, candidate: false };
  const [check] = await db.execute<{ id: string; eventKey: string; eventTitle: string; startsAt: string; status: string }>(sql`
    update proactive_eta_checks set status=${minutes === null ? 'failed' : 'answered'}, minutes=${minutes}, answered_at=now()
    where id=${checkId}::uuid and owner_email=${ownerEmail} and status='requested'
    returning id, event_key as "eventKey", event_title as "eventTitle", starts_at::text as "startsAt", status`);
  if (!check || minutes === null) return { accepted: Boolean(check), candidate: false };
  const startsAt = new Date(check.startsAt);
  if (startsAt.getTime() <= now.getTime()) return { accepted: true, candidate: false };
  const timeZone = (await getLifeProfile(ownerEmail)).profile?.timeZone ?? 'UTC';
  const timing = leaveTiming(startsAt, minutes, now);
  const title = timing.late ? `Running late for ${check.eventTitle}` : `Leave by ${clockTime(timing.leaveBy, timeZone)}`;
  const body = timing.late
    ? `It’s about ${minutes} min away and starts at ${clockTime(startsAt, timeZone)}. Want me to let them know?`
    : `${check.eventTitle} starts at ${clockTime(startsAt, timeZone)}, about ${minutes} min away by car with traffic.`;
  const card = engineDecision({
    ownerEmail, kind: 'leave', key: check.eventKey, category: 'schedule', title, body, urgency: 'high',
    why: [`${check.eventTitle} is on your calendar with an address, and the drive is about ${minutes} minutes right now.`],
    context: { event: check.eventTitle, startsAt: check.startsAt, travelMinutes: minutes },
    options: timing.late
      ? [{ label: 'Let them know', sublabel: `Tell the organizer of ${check.eventTitle} I’m running about ${timing.lateMinutes + 5} minutes late.`, actionType: 'approval' },
        { label: 'Call ahead', sublabel: `Call the place for ${check.eventTitle} to say I’m running late.`, actionType: 'approval' }]
      : [{ label: 'Share my ETA', sublabel: `Let the other attendees of ${check.eventTitle} know when I’ll arrive.`, actionType: 'approval' },
        { label: 'Got it', sublabel: 'No action needed.', actionType: 'no_action' }],
    actionableUntil: startsAt, now,
  });
  await publishDecisions(ownerEmail, () => [card]);
  const created = await addCandidates(ownerEmail, [{
    kind: 'leave_now', dedupeKey: `leave:${check.eventKey}`, decisionId: card.id, title, body,
    payload: { notificationId: card.id, category: 'schedule' }, expiresAt: startsAt,
  }], db);
  return { accepted: true, candidate: created > 0 };
}

/** Claim attempts atomically; lost pushes and temporary phone failures get bounded retries. */
export async function retryEtaChecks(owner: string, now: Date, db: EngineDb = getDb(), send = sendSilentPush) {
  const due = await db.execute<{ id: string; destination: string }>(sql`
    update proactive_eta_checks set status='requested', attempts=attempts+1, last_requested_at=${now.toISOString()}::timestamptz
    where owner_email=${owner} and status in ('requested','failed') and attempts < 3
      and starts_at > ${now.toISOString()}::timestamptz
      and (last_requested_at is null or last_requested_at <= ${new Date(now.getTime()-10*60_000).toISOString()}::timestamptz)
    returning id, destination`);
  for (const check of due) await send(owner, { dashEta: { checkId: check.id, destination: check.destination } }).catch(() => undefined);
  return due.length;
}
