import { NextResponse } from "next/server";
import { consumeMobileAuthHandoff } from "../../../../../lib/auth/mobile-handoff";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const sessionToken = await consumeMobileAuthHandoff(code);
  if (!sessionToken) return NextResponse.json({ error: "This sign-in handoff is invalid or expired." }, { status: 401 });

  // Native authentication decides separately whether this is a first-time
  // signup. Do not reuse the connected-source query flag here: that flag
  // intentionally rescans after adding another Google source, while an
  // ordinary mobile sign-in must only load the saved workspace.
  const destination = new URL("/", url.origin);
  const response = NextResponse.redirect(destination);
  response.headers.set("cache-control", "no-store");
  response.cookies.set("decision-feed.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
