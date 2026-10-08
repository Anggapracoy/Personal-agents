import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../lib/auth/session";
import { searchConversations } from "../../../../lib/conversation-search";

export async function GET(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ matches: await searchConversations(email, query) }, { headers: { "cache-control": "private, no-store" } });
}
