import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { getUsableGoogleConnections } from "../../../../lib/auth/google-connections";
import { fetchCalendarEventsInRange } from "../../../../lib/google";

const MAX_RANGE_MS = 36 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const timeMin = url.searchParams.get("timeMin") ?? "";
  const timeMax = url.searchParams.get("timeMax") ?? "";
  const connectionId = url.searchParams.get("connectionId");
  const min = Date.parse(timeMin);
  const max = Date.parse(timeMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || max - min > MAX_RANGE_MS) {
    return NextResponse.json({ error: "Choose a valid calendar day." }, { status: 400 });
  }

  const available = await getUsableGoogleConnections(session.user.email);
  const connections = connectionId ? available.filter((connection) => connection.id === connectionId) : available;
  if (connectionId && connections.length === 0) return NextResponse.json({ error: "Calendar connection not found." }, { status: 404 });

  const settled = await Promise.allSettled(connections.map(async (connection) => ({
    connection,
    events: await fetchCalendarEventsInRange(connection.accessToken, timeMin, timeMax),
  })));
  const events = settled.flatMap((result) => result.status === "fulfilled"
    ? result.value.events.map((event) => ({
      id: event.id,
      summary: event.summary ?? "Event",
      description: event.description ?? "",
      location: event.location ?? "",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
      attendees: (event.attendees ?? []).map((attendee) => attendee.email ?? attendee.displayName ?? "").filter(Boolean),
      htmlLink: event.htmlLink ?? "",
      sourceKind: "google" as const,
      sourceLabel: result.value.connection.email,
    }))
    : []);
  const warnings = settled.flatMap((result) => result.status === "rejected"
    ? [result.reason instanceof Error ? result.reason.message : "A Google Calendar could not be loaded."]
    : []);
  return NextResponse.json({ events, warnings });
}
