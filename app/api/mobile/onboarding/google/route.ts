import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { createMobileGoogleConnectionAuthorizationURL } from "../../../../../lib/auth/mobile-google-connection-oauth";

// Link to the authenticated Dash owner, preserving Apple sign-in and its session.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (request.headers.get("x-dash-google-connection-completion") !== "1") return NextResponse.json({ error: "Update the Dash iPhone app to connect Google securely." }, { status: 426 });
  const connectionId = `onboarding-${randomUUID()}`;
  const authorizationUrl = await createMobileGoogleConnectionAuthorizationURL({
    requestUrl: request.url,
    ownerEmail: session.user.email,
    runId: connectionId,
  });
  return NextResponse.json({ authorizationUrl: authorizationUrl.toString(), connectionId }, { headers: { "cache-control": "no-store" } });
}
