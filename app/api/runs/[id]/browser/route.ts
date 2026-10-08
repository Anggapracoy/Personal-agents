import { liveViewPage } from "../../../../../lib/harness/browser/live-view-page";
import { NextResponse } from "next/server";
import { currentUserEmail, getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { getRunStore } from "../../../../../lib/harness/store";
import { getCloudBrowser } from "../../../../../lib/harness/browser/registry";

import { browserSessionExpired, browserUnavailablePage, pendingTakeover, reopenTakeover } from "../../../../../lib/harness/browser/takeover-recovery";

function unavailable(id: string, error: unknown, canReopen: boolean) {
  return new Response(browserUnavailablePage(id, browserSessionExpired(error), canReopen), {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://production-sfo.browserless.io https://production-lon.browserless.io https://production-ams.browserless.io; frame-ancestors 'self'" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Invalid origin", { status: 403 });
  const owned = await getOwnedRunSnapshot(id);
  if (!owned.snapshot || !owned.email) return new Response("Please return to the conversation and sign in.", { status: owned.status });
  if (owned.snapshot.status !== "awaiting_approval") return new Response("Task is not waiting for browser takeover.", { status: 409 });
  const action = pendingTakeover(owned.snapshot.actions);
  if (!action || typeof action.input.pageUrl !== "string") return unavailable(id, new Error("No pending takeover"), false);
  const browser = getCloudBrowser(owned.email, id);
  try {
    // A retry must not reload a browser that is still alive or replay actions.
    await reopenTakeover(browser, owned.email, action.input.pageUrl);
    return NextResponse.redirect(new URL(`/api/runs/${encodeURIComponent(id)}/browser?control=1`,request.url),303);
  } catch (error) { return unavailable(id, error, true); }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const controlEnabled = params.get("control") === "1";
  if (params.get("health") === "1") {
    const headers = { "Cache-Control": "no-store" };
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    // Do not load action history or artifact contents for a periodic health read.
    const run = await getRunStore().getRun(id);
    if (!run || run.userId.toLowerCase() !== email) return NextResponse.json({ error: "Run not found" }, { status: 404, headers });
    if (["done", "failed", "cancelled"].includes(run.status)) return NextResponse.json({ state: "inactive" }, { headers });
    try {
      const state = await getCloudBrowser(email, id).viewerHealth(email, controlEnabled);
      return NextResponse.json({ state }, { headers });
    } catch {
      // A failed health read is not evidence that the live viewer disconnected.
      return NextResponse.json({ state: "unknown" }, { status: 503, headers });
    }
  }
  if (controlEnabled) {
    // The old iOS wrapper also enters takeover through this URL. Establish the
    // durable pause before handing out any interactive stream, on every client.
    const owned = await getOwnedRunSnapshot(id);
    if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Run not found" }, { status: owned.status });
    const lastPage = [...owned.snapshot.actions].reverse().map(action => action.result?.url ?? action.input.pageUrl ?? action.input.url)
      .find((value): value is string => typeof value === "string" && /^https?:\/\//.test(value));
    const action = await getRunStore().beginManualTakeover(id, owned.email, lastPage);
    if (!action) {
      const message = "Browser takeover is unavailable while this task is waiting for another response.";
      if (params.get("stream") === "1") return NextResponse.json({ error: message }, { status: 409 });
      return unavailable(id, new Error(message), false);
    }
  }
  if (params.get("stream") === "1") {
    const headers = { "Cache-Control": "no-store" };
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const run = await getRunStore().getRun(id);
    if (!run || run.userId.toLowerCase() !== email) return NextResponse.json({ error: "Run not found" }, { status: 404, headers });
    if (["done", "failed", "cancelled"].includes(run.status)) return NextResponse.json({ active: false }, { headers });
    const controlSnapshot=controlEnabled?await getRunStore().getSnapshot(id):null;
    if(controlEnabled&&(!controlSnapshot||(controlSnapshot.status!=="running"&&!(controlSnapshot.status==="awaiting_approval"&&pendingTakeover(controlSnapshot.actions)))))return NextResponse.json({error:"Takeover is no longer available"},{status:409,headers});
    try {
      const browser = getCloudBrowser(email, id);
      // An explicit takeover must replace the prior passive mint. Only a stale
      // passive viewer stops when a different viewer has acquired control.
      if (!controlEnabled && await browser.viewerHealth(email, false).catch(() => "unknown") === "mode_changed") return NextResponse.json({ active: true, modeChanged: true }, { headers });
      const url = controlEnabled ? await browser.takeoverUrl(email) : await browser.watchUrl(email, params.get("refresh") === "1");
      return NextResponse.json({ active: true, url }, { headers });
    } catch (error) { return NextResponse.json({ error: "Live view unavailable.",expired:browserSessionExpired(error),canReopen:controlEnabled&&Boolean(controlSnapshot&&pendingTakeover(controlSnapshot.actions)) }, { status: 503, headers }); }
  }
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (controlEnabled && owned.snapshot.status !== "running" && !(owned.snapshot.status === "awaiting_approval" && pendingTakeover(owned.snapshot.actions))) {
    return NextResponse.json({ error: "Browser takeover is only available while the task is running." }, { status: 409 });
  }
  const page = liveViewPage(id, controlEnabled);
  return new Response(page.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": page.csp, "Referrer-Policy": "no-referrer" } });
}
