import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (process.env.ENABLE_BACKGROUND_SCAN !== "true") {
    return NextResponse.json({ enabled: false, message: "Background scans are disabled. Manual scans remain available." });
  }
  if (process.env.CRON_SECRET && request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Wire to the same Gmail/Calendar extraction pipeline as /api/scan in production.
  return NextResponse.json({ enabled: true, scannedAt: new Date().toISOString() });
}
