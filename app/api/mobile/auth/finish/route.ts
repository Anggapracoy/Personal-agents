import { auth } from '../../../../../auth';
import { getToken } from 'next-auth/jwt';
import { enforceApiQuota } from '../../../../../lib/api-quota';
import { createMobileAuthHandoff, validHandoffChallenge } from "../../../../../lib/auth/mobile-handoff";

export const dynamic = "force-dynamic";

const sessionCookieName = "decision-feed.session-token";

export async function GET(request: Request) {
  const challenge = new URL(request.url).searchParams.get('handoffChallenge') ?? '';
  if (!validHandoffChallenge(challenge)) return new Response('A device challenge is required.', { status: 400 });
  const session = await auth();
  if (!session?.user?.email) return new Response('Authentication did not establish a valid session.', { status: 401 });
  // Auth.js above validates the JWT and revocation state. Read the same raw
  // cookie afterward, including Auth.js's chunked-cookie representation.
  const sessionToken = await getToken({ req: request, cookieName: sessionCookieName, raw: true });
  if (!sessionToken) return new Response('Authentication did not establish a session.', { status: 401 });
  const limited = await enforceApiQuota(session.user.email, 'handoff');
  if (limited) return limited;
  const code = await createMobileAuthHandoff(sessionToken, challenge);
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location: `decisionfeed://auth?code=${encodeURIComponent(code)}`,
      "referrer-policy": "no-referrer",
    },
  });
}
