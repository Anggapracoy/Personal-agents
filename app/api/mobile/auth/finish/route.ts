import { cookies } from "next/headers";
import { createMobileAuthHandoff } from "../../../../../lib/auth/mobile-handoff";

export const dynamic = "force-dynamic";

const sessionCookieName = "decision-feed.session-token";

export async function GET() {
  const sessionToken = (await cookies()).get(sessionCookieName)?.value;
  if (!sessionToken) return new Response("Authentication did not establish a session.", { status: 401 });
  const code = await createMobileAuthHandoff(sessionToken);
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location: `decisionfeed://auth?code=${encodeURIComponent(code)}`,
      "referrer-policy": "no-referrer",
    },
  });
}
