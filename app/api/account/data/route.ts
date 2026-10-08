import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../lib/auth/session";
import { sameOrigin } from "../../../../lib/http-security";
import { deleteUserData } from "../../../../lib/user-data";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin deletion is blocked." }, { status: 403 });
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { confirmation?: unknown };
  if (body.confirmation !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  return NextResponse.json(await deleteUserData(email, { deleteAccount: false }), { headers: { "cache-control": "no-store", "clear-site-data": '"cache"' } });
}
