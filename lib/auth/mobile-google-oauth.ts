
import { googleOAuthOrigin } from "./google-oauth-origin";
import { createHash, randomBytes } from "node:crypto";
import { decode, encode } from "next-auth/jwt";
import { createMobileAuthHandoff, validHandoffChallenge } from "./mobile-handoff";
import { upsertConnectedGoogleAccount } from "./google-connections";
import { isAccountDeletionPending, newSessionIdentity } from "./session-revocation";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PROFILE_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const MOBILE_STATE_SALT = "wdyt.mobile.google.oauth-state";
export const MOBILE_GOOGLE_STATE_PREFIX = "wdyt_mobile.";
const SESSION_COOKIE_NAME = "decision-feed.session-token";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const scopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
];

type MobileGoogleState = {
  kind: "mobile-google";
  verifier: string;
  redirectUri: string;
  handoffChallenge: string;
};

function configuration() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  const authSecret = process.env.AUTH_SECRET;
  if (!clientId || !clientSecret || !authSecret) throw new Error("Mobile Google authentication is not configured.");
  return { clientId, clientSecret, authSecret };
}

export async function createMobileGoogleAuthorizationURL(requestUrl: string) {
  const { clientId, authSecret } = configuration();
  const handoffChallenge = new URL(requestUrl).searchParams.get('handoffChallenge') ?? '';
  if (!validHandoffChallenge(handoffChallenge)) throw new Error('A device challenge is required.');
  const origin = googleOAuthOrigin(requestUrl);
  const redirectUri = `${origin}/api/auth/callback/google`;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const encryptedState = await encode({
    secret: authSecret,
    salt: MOBILE_STATE_SALT,
    maxAge: 10 * 60,
    token: { kind: "mobile-google", verifier, redirectUri, handoffChallenge } satisfies MobileGoogleState,
  });
  const target = new URL(GOOGLE_AUTHORIZATION_URL);
  target.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: `${MOBILE_GOOGLE_STATE_PREFIX}${encryptedState}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return target;
}

async function readMobileGoogleState(value: string) {
  const { authSecret } = configuration();
  if (!value.startsWith(MOBILE_GOOGLE_STATE_PREFIX)) throw new Error("The mobile Google state is invalid.");
  const token = await decode({ token: value.slice(MOBILE_GOOGLE_STATE_PREFIX.length), secret: authSecret, salt: MOBILE_STATE_SALT });
  if (
    token?.kind !== "mobile-google" ||
    typeof token.verifier !== "string" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(token.verifier) ||
    typeof token.redirectUri !== "string" ||
    typeof token.handoffChallenge !== 'string' || !validHandoffChallenge(token.handoffChallenge)
  ) throw new Error("The mobile Google state is invalid or expired.");
  return token as MobileGoogleState;
}

function finish(error: string) {
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location: `decisionfeed://auth?error=${encodeURIComponent(error)}`,
      "referrer-policy": "no-referrer",
    },
  });
}

export async function handleMobileGoogleCallback(request: Request) {
  try {
    const { clientId, clientSecret, authSecret } = configuration();
    const url = new URL(request.url);
    const stateValue = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!stateValue || !code) return finish(url.searchParams.get("error") ? "cancelled" : "invalid_response");
    const state = await readMobileGoogleState(stateValue);
    if (new URL(state.redirectUri).origin !== url.origin) return finish("invalid_state");

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: state.redirectUri,
        grant_type: "authorization_code",
        code_verifier: state.verifier,
      }),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return finish("token_exchange");
    const googleToken = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!googleToken.access_token) return finish("token_exchange");

    const profileResponse = await fetch(GOOGLE_PROFILE_URL, {
      headers: { authorization: `Bearer ${googleToken.access_token}` },
      cache: "no-store",
    });
    if (!profileResponse.ok) return finish("profile");
    const profile = await profileResponse.json() as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!profile.sub || !profile.email || profile.email_verified !== true) return finish("profile");

    if (await isAccountDeletionPending(profile.email)) return finish("deletion_pending");

    const accessTokenExpires = Date.now() + (googleToken.expires_in ?? 3600) * 1000;
    await upsertConnectedGoogleAccount({
      ownerEmail: profile.email,
      googleSubject: profile.sub,
      email: profile.email,
      name: profile.name,
      accessToken: googleToken.access_token,
      refreshToken: googleToken.refresh_token,
      expiresAt: accessTokenExpires,
      scopes: googleToken.scope,

    });
    const sessionToken = await encode({
      secret: authSecret,
      salt: SESSION_COOKIE_NAME,
      maxAge: SESSION_MAX_AGE_SECONDS,
      token: {
        ...newSessionIdentity(),
        sub: profile.sub,
        email: profile.email,
        name: profile.name ?? profile.email.split("@")[0],
        picture: profile.picture,
        authProvider: "google",
        accessToken: googleToken.access_token,
        refreshToken: googleToken.refresh_token,
        accessTokenExpires,
      },
    });
    const handoff = await createMobileAuthHandoff(sessionToken, state.handoffChallenge);

    return new Response(null, {
      status: 302,
      headers: {
        "cache-control": "no-store",
        location: `decisionfeed://auth?code=${encodeURIComponent(handoff)}`,
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[mobile-auth] Google callback failed", error instanceof Error ? error.message : "Unknown error");
    return finish("invalid_state");
  }
}
