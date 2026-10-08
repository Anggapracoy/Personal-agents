import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { sameOrigin } from "../../../../lib/http-security";
import { connectorFailureMessage, composioConfigured, connectToolkit, disconnectToolkit, listConnectors, usableConnectors } from "../../../../lib/composio/service";
import { z } from "zod";
const change = z.object({ slug: z.string().regex(/^[a-z0-9_-]{1,100}$/), accountId: z.string().min(1).max(200).optional() });
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Sign in to Dash first." }, { status: 401 });
  if (!composioConfigured()) return NextResponse.json({ configured: false, items: [], cursor: null });
  const params = new URL(request.url).searchParams;
  if (params.get("count") === "1") {
    try {
      const access = await usableConnectors(session.user.email);
      return NextResponse.json({ connectedCount: new Set([...access.enabled, ...access.accounts.map(a => a.toolkit.slug)]).size }, { headers: { "Cache-Control": "private, no-store" } });
    } catch { return NextResponse.json({ error: "Couldn't load connections." }, { status: 502 }); }
  }
  try { return NextResponse.json({ configured: true, ...await listConnectors(session.user.email, (params.get("search") ?? "").slice(0,200), params.get("cursor")?.slice(0,1000)) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Couldn't load connectors. Try again." }, { status: 502 }); }
}
async function mutate(request: Request, disconnect: boolean) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "This connection change was blocked. Reopen Dash and try again." }, { status: 403 });
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Sign in to Dash first." }, { status: 401 });
  const parsed = change.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a supported app." }, { status: 400 });
  try {
    if (disconnect) { await disconnectToolkit(session.user.email, parsed.data.slug, parsed.data.accountId); return NextResponse.json({ disconnected: true }); }
    // Status is refreshed from Composio after return, never trusted from URL parameters.
    return NextResponse.json(await connectToolkit(session.user.email, parsed.data.slug, new URL("/?connections=1", request.url).href));
  } catch (error) { return NextResponse.json({ error: connectorFailureMessage(error, disconnect ? "Couldn't disconnect this account. Try again." : "Couldn't start this connection. Try again.") }, { status: 502 }); }
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
