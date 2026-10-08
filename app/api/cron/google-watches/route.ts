import { NextRequest, NextResponse } from "next/server";
import { secureStringEqual, ensureAllGoogleSourceWatches } from "../../../../lib/google-push";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !secureStringEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const results = await ensureAllGoogleSourceWatches();
  return NextResponse.json({ renewed: results.length, results });
}
