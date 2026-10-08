import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { exchangeGoogleCode } from "../../../../../lib/auth/google-code-exchange";
import { upsertConnectedGoogleAccount } from "../../../../../lib/auth/google-connections";
import { readMobileGoogleConnectionCompletion } from "../../../../../lib/auth/mobile-google-connection-oauth";

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  try {
    const body = await request.json();
    if (typeof body?.completion !== "string" || body.completion.length > 16000 || typeof body.runId !== "string") throw new Error("Invalid completion.");
    const exchange = await readMobileGoogleConnectionCompletion({ completion: body.completion, runId: body.runId, ownerEmail: session.user.email, requestUrl: request.url });
    // Identity validation happens BEFORE exchanging the code or saving credentials.
    // Google authorization codes are single-use, so replays cannot save twice.
    const { token, profile } = await exchangeGoogleCode(exchange);
    await upsertConnectedGoogleAccount({ ownerEmail: session.user.email, googleSubject: profile.sub, email: profile.email, name: profile.name, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000, scopes: token.scope });
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Google connection could not be completed. Start again from your Dash account." }, { status: 400, headers });
  }
}
