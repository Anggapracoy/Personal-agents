import { NextRequest, NextResponse } from "next/server";
import { dispatchGoogleSourceChange } from "../../../../../lib/google-push-dispatch";
import {
  calendarChannelToken,
  getGoogleWatchContextByCalendarChannel,
  recordGoogleSourceNotification,
  secureStringEqual,
} from "../../../../../lib/google-push";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  const resourceState = request.headers.get("x-goog-resource-state");
  if (!channelId || !resourceId) return NextResponse.json({ error: "Missing channel headers." }, { status: 400 });

  const connection = await getGoogleWatchContextByCalendarChannel(channelId);
  if (!connection || connection.calendarResourceId !== resourceId) {
    return NextResponse.json({ error: "Unknown channel." }, { status: 404 });
  }
  const expectedToken = calendarChannelToken(connection.connectionId);
  if (!secureStringEqual(request.headers.get("x-goog-channel-token"), expectedToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await recordGoogleSourceNotification(connection.connectionId, "calendar");
  // Google sends a sync message as soon as a channel is created. The initial
  // account scan already establishes state, so only real changes need a job.
  if (resourceState !== "sync") {
    await dispatchGoogleSourceChange({ connectionId: connection.connectionId, source: "calendar" });
  }
  return new NextResponse(null, { status: 204 });
}
