import crypto from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_ENDPOINT = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export function createOAuthState() {
  return crypto.randomBytes(32).toString('base64url');
}

export function createCodeVerifier() {
  return crypto.randomBytes(48).toString('base64url');
}

export function createCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  if (!clientId || !redirectUri || !state || !codeChallenge) throw new Error('OAuth configuration is incomplete');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: SCOPE, state, code_challenge: codeChallenge, code_challenge_method: 'S256' });
  return `${AUTH_ENDPOINT}?${params}`;
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const response = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${body.error_description || body.error || 'request failed'}`);
  return body;
}

export async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  const response = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google OAuth refresh ${response.status}: ${body.error_description || body.error || 'request failed'}`);
  return body;
}

export async function revokeToken(token) {
  const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  if (!response.ok && response.status !== 400) throw new Error(`Google OAuth revoke ${response.status}`);
  return true;
}

export async function listEvents({ accessToken, timeMin, timeMax, calendarId = 'primary' }) {
  const params = new URLSearchParams({ timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString(), singleEvents: 'true', orderBy: 'startTime' });
  const response = await fetch(`${CALENDAR_ENDPOINT}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google Calendar ${response.status}: ${body.error?.message || 'request failed'}`);
  return body.items || [];
}

export function buildCalendarEvent({ summary, description = '', start, end, timeZone = 'Asia/Jakarta', attendees = [] }) {
  if (!summary || !(new Date(start) < new Date(end))) throw new Error('calendar event details are invalid');
  return { summary, description, start: { dateTime: new Date(start).toISOString(), timeZone }, end: { dateTime: new Date(end).toISOString(), timeZone }, ...(attendees.length ? { attendees: attendees.map(email => ({ email })) } : {}) };
}

export async function createEvent({ accessToken, event, calendarId = 'primary' }) {
  const response = await fetch(`${CALENDAR_ENDPOINT}/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(event) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google Calendar ${response.status}: ${body.error?.message || 'request failed'}`);
  return body;
}

export function suggestSlots(events, requestedStart, { durationMinutes = 60, count = 3, stepMinutes = 30 } = {}) {
  const start = new Date(requestedStart); const suggestions = [];
  for (let i = 0; suggestions.length < count && i < 48; i++) {
    const candidateStart = new Date(start.getTime() + i * stepMinutes * 60000); const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60000);
    if (!findConflicts(events, candidateStart, candidateEnd).length) suggestions.push({ start: candidateStart, end: candidateEnd });
  }
  return suggestions;
}

export function eventInterval(event) {
  const start = event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00Z` : null);
  const end = event.end?.dateTime || (event.end?.date ? `${event.end.date}T00:00:00Z` : null);
  return start && end ? { start: new Date(start), end: new Date(end) } : null;
}

export function findConflicts(events, requestedStart, requestedEnd) {
  const start = new Date(requestedStart); const end = new Date(requestedEnd);
  if (!(start < end)) throw new Error('requested interval is invalid');
  return events.filter(event => { const interval = eventInterval(event); return interval && interval.start < end && interval.end > start; });
}
