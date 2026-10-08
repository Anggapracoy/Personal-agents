import { signIn } from "../../../../../auth";
import { mobileAuthStart } from "../../../../../lib/auth/mobile-start";
import { createMobileGoogleAuthorizationURL } from "../../../../../lib/auth/mobile-google-oauth";
import { validHandoffChallenge } from '../../../../../lib/auth/mobile-handoff';

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!validHandoffChallenge(new URL(request.url).searchParams.get('handoffChallenge') ?? '')) return Response.json({ error: 'Update the iPhone app to sign in securely.' }, { status: 400 });
  const { provider, redirectTo } = mobileAuthStart(request);

  if (provider === "google") {
    return Response.redirect(await createMobileGoogleAuthorizationURL(request.url), 302);
  }

  // Start OAuth as a top-level server redirect. This makes the PKCE verifier
  // cookie part of the navigation response instead of relying on WebKit to
  // persist a cookie created by a client-side fetch before leaving the site.
  await signIn(provider, { redirectTo });

  return new Response("Unable to start sign-in.", { status: 500 });
}
