import { withRequestBodyLimit } from "../../../../lib/request-body-limit";
import type { NextRequest } from "next/server";
import { handlers } from "../../../../auth";
import { handleMobileGoogleCallback, MOBILE_GOOGLE_STATE_PREFIX } from "../../../../lib/auth/mobile-google-oauth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/api/auth/callback/google") && url.searchParams.get("state")?.startsWith(MOBILE_GOOGLE_STATE_PREFIX)) {
    return handleMobileGoogleCallback(request);
  }
  return handlers.GET(request);
}

async function POSTHandler(request: NextRequest) {
  const response = await handlers.POST(request);
  if (new URL(request.url).pathname.endsWith('/signout')) response.headers.set('clear-site-data', '"cache"');
  return response;
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
