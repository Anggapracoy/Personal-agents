import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { NextRequest, NextResponse } from "next/server";
import { dispatchGoogleSourceChange } from "../../../../../lib/google-push-dispatch";
import {
  decodeGmailPubSubMessage,
  findGoogleWatchContextsByAccountEmail,
  recordGoogleSourceNotification,
  secureStringEqual,
} from "../../../../../lib/google-push";

export const runtime = "nodejs";

async function POSTHandler(request: NextRequest) {
  const expected = process.env.GOOGLE_GMAIL_WEBHOOK_SECRET;
  if (!expected) return NextResponse.json({ error: "Gmail push is not configured." }, { status: 503 });
  if (!secureStringEqual(request.nextUrl.searchParams.get("token"), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const rawBody = await request.text();
  let payload: unknown = rawBody;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Unwrapped Pub/Sub delivery can send the encoded data as the entire body.
  }
  const notification = decodeGmailPubSubMessage(payload);
  if (!notification) return NextResponse.json({ error: "Invalid Pub/Sub message." }, { status: 400 });

  const connections = await findGoogleWatchContextsByAccountEmail(notification.emailAddress);
  await Promise.all(connections.map(async (connection) => {
    await recordGoogleSourceNotification(connection.connectionId, "gmail");
    await dispatchGoogleSourceChange({
      connectionId: connection.connectionId,
      source: "gmail",
      historyId: notification.historyId,
    });
  }));
  return new NextResponse(null, { status: 204 });
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
