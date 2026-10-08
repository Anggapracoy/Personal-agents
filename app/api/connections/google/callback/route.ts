import { exchangeGoogleCode } from "../../../../../lib/auth/google-code-exchange";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { upsertConnectedGoogleAccount } from "../../../../../lib/auth/google-connections";
import {
  MOBILE_GOOGLE_CONNECTION_STATE_PREFIX,
  mobileGoogleConnectionResult,
  readMobileGoogleConnectionState,
  createMobileGoogleConnectionCompletion,
} from "../../../../../lib/auth/mobile-google-connection-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnedState = url.searchParams.get("state") ?? "";
  if (returnedState.startsWith(MOBILE_GOOGLE_CONNECTION_STATE_PREFIX)) {
    let runId = "";
    try {
      const state = await readMobileGoogleConnectionState(returnedState);
      runId = state.runId;
      if (new URL(state.redirectUri).origin !== url.origin) return mobileGoogleConnectionResult(runId, "invalid_state");
      const code = url.searchParams.get("code");
      if (!code) return mobileGoogleConnectionResult(runId, url.searchParams.get("error") ? "cancelled" : "invalid_response");
      // The browser callback is not authenticated as the initiating Dash user.
      // Return a short-lived result to the app; never link from this request.
      const completion = await createMobileGoogleConnectionCompletion(returnedState, code);
      return mobileGoogleConnectionResult(runId, undefined, completion);
    } catch (error) {
      console.error("[google-connection] mobile reconnect failed", error instanceof Error ? error.message : "Unknown error");
      return mobileGoogleConnectionResult(runId, "reconnect_failed");
    }
  }

  const session = await auth();
  const cookieStore = await cookies();
  const state = cookieStore.get("wdyt.google-link-state")?.value;
  const verifier = cookieStore.get("wdyt.google-link-verifier")?.value;
  const clearAndRedirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url));
    response.cookies.delete("wdyt.google-link-state");
    response.cookies.delete("wdyt.google-link-verifier");
    return response;
  };
  if (!session?.user?.email) return clearAndRedirect("/login");
  if (!state || state !== url.searchParams.get("state") || !verifier) return clearAndRedirect("/?connectionError=invalid_state");
  const code = url.searchParams.get("code");
  if (!code) return clearAndRedirect("/?connectionError=cancelled");
  const origin = url.origin;
  let token: Awaited<ReturnType<typeof exchangeGoogleCode>>["token"];
  let profile: Awaited<ReturnType<typeof exchangeGoogleCode>>["profile"];
  try {
    ({ token, profile } = await exchangeGoogleCode({ code, verifier, redirectUri: `${origin}/api/connections/google/callback` }));
  } catch (error) {
    return clearAndRedirect(`/?connectionError=${error instanceof Error && error.message === "profile" ? "profile" : "token_exchange"}`);
  }
  await upsertConnectedGoogleAccount({ ownerEmail: session.user.email, googleSubject: profile.sub, email: profile.email, name: profile.name, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000, scopes: token.scope });
  return clearAndRedirect("/?connected=1&connections=1");
}
