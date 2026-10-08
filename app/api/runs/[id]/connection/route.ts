import { NextResponse } from "next/server";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { connectToolkit, isConnectorConnected, connectorFailureMessage } from "../../../../../lib/composio/service";
import { sameOrigin } from "../../../../../lib/http-security";

async function connection(request: Request, context: { params: Promise<{ id: string }> }, start: boolean) {
  if (start && !sameOrigin(request)) return NextResponse.json({ error: "Cross-origin connection changes are blocked." }, { status: 403 });
  const { id } = await context.params;
  const owned = await getOwnedRunSnapshot(id);
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Conversation unavailable." }, { status: owned.status });
  const actionId = new URL(request.url).searchParams.get("actionId");
  const action = owned.snapshot.actions.find(action => action.id === actionId && action.toolName === "connector_request_connection");
  if (!action || action.status !== "proposed" || owned.snapshot.status !== "awaiting_approval") return NextResponse.json({ error: "This connection request is no longer pending." }, { status: 409 });
  const slug = String(action.input.toolkit);
  try {
    if (await isConnectorConnected(owned.email, slug)) return NextResponse.json({ connected: true }, { headers: { "Cache-Control": "private, no-store" } });
    if (!start) return NextResponse.json({ connected: false }, { headers: { "Cache-Control": "private, no-store" } });
    const callback = new URL("/", request.url);
    callback.searchParams.set("task", owned.snapshot.decisionId ?? id);
    return NextResponse.json(await connectToolkit(owned.email, slug, callback.href), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: connectorFailureMessage(error, "Couldn't check or start this connection. Try again.") }, { status: 502 }); }
}
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => connection(request, context, false);
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => connection(request, context, true);
