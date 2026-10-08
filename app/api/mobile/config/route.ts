import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const webBuildId = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || process.env.DECISION_FEED_BUILD_ID?.trim()
    || process.env.VERCEL_DEPLOYMENT_ID?.trim()
    || process.env.VERCEL_URL?.trim()
    || "development";
  const response = NextResponse.json({
    minWrapperVersion: 2,
    maxWrapperVersion: 2,
    webBuildId,
    optionalBridgeActions: ["appleConnections"],
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
