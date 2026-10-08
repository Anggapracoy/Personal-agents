import { googleOAuthOrigin } from "./google-oauth-origin";
import { createHash, randomBytes } from "node:crypto";
import { decode, encode } from "next-auth/jwt";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const MOBILE_CONNECTION_STATE_SALT = "wdyt.mobile.google.connection-oauth-state";
export const MOBILE_GOOGLE_CONNECTION_STATE_PREFIX = "wdyt_connection.";
const scopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
];

export type MobileGoogleConnectionState = {
  kind: "mobile-google-connection";
  ownerEmail: string;
  runId: string;
  verifier: string;
  redirectUri: string;
  requestOrigin?: string;
};

function configuration() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const authSecret = process.env.AUTH_SECRET;
  if (!clientId || !authSecret) throw new Error("Mobile Google reconnect is not configured.");
  return { clientId, authSecret };
}

export async function createMobileGoogleConnectionAuthorizationURL(input: {
  requestUrl: string;
  ownerEmail: string;
  runId: string;
}) {
  const { clientId, authSecret } = configuration();
  const origin = googleOAuthOrigin(input.requestUrl);
  const redirectUri = `${origin}/api/connections/google/callback`;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const encryptedState = await encode({
    secret: authSecret,
    salt: MOBILE_CONNECTION_STATE_SALT,
    maxAge: 10 * 60,
    token: {
      kind: "mobile-google-connection",
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      runId: input.runId,
      verifier,
      redirectUri,
      requestOrigin: new URL(input.requestUrl).origin,
    } satisfies MobileGoogleConnectionState,
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
    state: `${MOBILE_GOOGLE_CONNECTION_STATE_PREFIX}${encryptedState}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return target;
}

export async function readMobileGoogleConnectionState(value: string) {
  const { authSecret } = configuration();
  if (!value.startsWith(MOBILE_GOOGLE_CONNECTION_STATE_PREFIX)) throw new Error("The mobile Google reconnect state is invalid.");
  const token = await decode({
    token: value.slice(MOBILE_GOOGLE_CONNECTION_STATE_PREFIX.length),
    secret: authSecret,
    salt: MOBILE_CONNECTION_STATE_SALT,
  });
  if (
    token?.kind !== "mobile-google-connection"
    || typeof token.ownerEmail !== "string"
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token.ownerEmail)
    || typeof token.runId !== "string"
    || token.runId.length < 1
    || token.runId.length > 200
    || typeof token.verifier !== "string"
    || !/^[A-Za-z0-9_-]{43,128}$/.test(token.verifier)
    || typeof token.redirectUri !== "string"
  ) throw new Error("The mobile Google reconnect state is invalid or expired.");
  return token as MobileGoogleConnectionState;
}

export function mobileGoogleConnectionResult(runId: string, error?: string, completion?: string) {
  const target = new URL("decisionfeed://auth");
  target.searchParams.set("googleReconnectRun", runId);
  if (error) target.searchParams.set("error", error);
  if (completion) target.searchParams.set("completion", completion);
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location: target.toString(),
      "referrer-policy": "no-referrer",
    },
  });
}

const COMPLETION_SALT = "wdyt.mobile.google.connection-completion";

// This token contains an unredeemed, single-use Google code, never Google tokens.
// It is delivered only through the authorization browser's return to the app.
export async function createMobileGoogleConnectionCompletion(state: string, code: string) {
  return encode({ secret: configuration().authSecret, salt: COMPLETION_SALT, maxAge: 120,
    token: { kind: "mobile-google-connection-completion", state, code } });
}

export async function readMobileGoogleConnectionCompletion(input: {
  completion: string; ownerEmail: string; runId: string; requestUrl: string;
}) {
  const result = await decode({ token: input.completion, secret: configuration().authSecret, salt: COMPLETION_SALT });
  if (result?.kind !== "mobile-google-connection-completion" || typeof result.state !== "string"
      || typeof result.code !== "string" || !result.code || result.code.length > 4096) {
    throw new Error("Invalid Google connection completion.");
  }
  const state = await readMobileGoogleConnectionState(result.state);
  if (state.ownerEmail !== input.ownerEmail.trim().toLowerCase() || state.runId !== input.runId
      || (state.requestOrigin
        ? state.requestOrigin !== new URL(input.requestUrl).origin
          || state.redirectUri !== `${googleOAuthOrigin(input.requestUrl)}/api/connections/google/callback`
        : state.redirectUri !== `${new URL(input.requestUrl).origin}/api/connections/google/callback`)) {
    throw new Error("Google connection does not belong to this account or request.");
  }
  return { code: result.code, verifier: state.verifier, redirectUri: state.redirectUri };
}
