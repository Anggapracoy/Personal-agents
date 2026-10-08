import { withRequestBodyLimit } from "../../../lib/request-body-limit";

import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { checkGoogleConnectionHealth, removeGoogleConnection, setGoogleConnectionEnabled } from "../../../lib/auth/google-connections";
import { sameOrigin } from "../../../lib/http-security";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const accounts = await checkGoogleConnectionHealth(session.user.email);
  return NextResponse.json({ accounts }, { headers: { "cache-control": "no-store" } });
}

async function PATCHHandler(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin connection changes are blocked." }, { status: 403 });
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { id?: unknown; enabled?: unknown };
  if (typeof body.id !== "string" || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Invalid connection update." }, { status: 400 });
  const updated = await setGoogleConnectionEnabled(session.user.email, body.id, body.enabled);

  return NextResponse.json({ updated }, { status: updated ? 200 : 404 });
}

async function DELETEHandler(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin connection changes are blocked." }, { status: 403 });
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Connection id is required." }, { status: 400 });
  const removed = await removeGoogleConnection(session.user.email, id);

  return NextResponse.json({ removed }, { status: removed ? 200 : 404 });
}

export const PATCH = withRequestBodyLimit(PATCHHandler, 1048576);

export const DELETE = withRequestBodyLimit(DELETEHandler, 1048576);
