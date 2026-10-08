import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { createMobileGoogleConnectionAuthorizationURL } from "../../../../../lib/auth/mobile-google-connection-oauth";
import { getRunStore } from "../../../../../lib/harness/store";

const scopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar.events"];

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.redirect(new URL("/login", request.url));
  if (!process.env.AUTH_GOOGLE_ID) return NextResponse.json({ error: "Google OAuth is not configured." }, { status: 503 });
  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.get("native") === "1") {
    if (requestUrl.searchParams.get("completion") !== "1") return NextResponse.json({ error: "Update the Dash iPhone app to reconnect Google securely." }, { status: 426 });
    const runId = requestUrl.searchParams.get("runId") ?? "";
    const run = runId ? await getRunStore().getRun(runId) : null;
    if (!run || run.userId.trim().toLowerCase() !== session.user.email.trim().toLowerCase()) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    const target = await createMobileGoogleConnectionAuthorizationURL({ requestUrl: request.url, ownerEmail: session.user.email, runId });
    return NextResponse.json({ authorizationUrl: target.toString() }, { headers: { "cache-control": "no-store" } });
  }
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const origin = requestUrl.origin;
  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.search = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID,
    redirect_uri: `${origin}/api/connections/google/callback`,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const response = NextResponse.redirect(target);
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
  response.cookies.set("wdyt.google-link-state", state, options);
  response.cookies.set("wdyt.google-link-verifier", verifier, options);
  return response;
}
