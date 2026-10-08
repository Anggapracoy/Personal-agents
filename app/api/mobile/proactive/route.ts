import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../lib/auth/session";
import { proactiveEngineEnabled } from "../../../../lib/proactive/engine/candidates";

/** The iPhone only starts wake, location and ETA signals for accounts with proactive v2. */
export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json({ enabled: await proactiveEngineEnabled(email) }, { headers: { "cache-control": "private, no-store" } });
}
