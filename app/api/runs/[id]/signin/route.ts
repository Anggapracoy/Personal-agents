import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { transferSignInSession } from "../../../../../lib/harness/signin-handoff";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { getCloudBrowser } from "../../../../../lib/harness/browser/registry";
import { resumeRun } from "../../../../../lib/harness/resume";
import { getRunStore } from "../../../../../lib/harness/store";

const cookieSchema = z.object({
  name: z.string().min(1).max(4_096),
  value: z.string().max(8_192),
  domain: z.string().min(1).max(253),
  path: z.string().max(1_024).default("/"),
  secure: z.boolean().default(true),
  httpOnly: z.boolean().default(false),
  expires: z.number().nullable().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).nullable().optional(),
});
const bodySchema = z.object({
  actionId: z.string().uuid(),
  ok: z.boolean(),
  finalUrl: z.string().max(4_096).optional(),
  cookies: z.array(cookieSchema).max(200).default([]),
});

/** Registrable-domain match: `.login.delta.com` belongs to `delta.com`; `evil.com` does not. */
function belongsTo(cookieDomain: string, host: string) {
  const domain = cookieDomain.replace(/^\./, "").toLowerCase();
  const target = host.toLowerCase();
  if (domain === target) return true;
  const base = registrable(target);
  return domain === base || domain.endsWith(`.${base}`) || target.endsWith(`.${domain}`);
}
function registrable(host: string) {
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

/**
 * Sign-in handoff: the user signed in on their phone inside our in-app browser.
 * Their session cookies for that site are imported into the cloud browser, the
 * page is reloaded, and the thread resumes. Cookies are never persisted here.
 */
async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sign-in result." }, { status: 400 });
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (owned.snapshot.status !== "awaiting_approval") return NextResponse.json({ error: "This task is no longer waiting for a sign-in." }, { status: 409 });
  const store = getRunStore();
  const action = await store.getAction(parsed.data.actionId, id);
  if (!action || action.toolName !== "browser_request_signin" || action.status !== "proposed") return NextResponse.json({ error: "This sign-in request is no longer pending." }, { status: 409 });
  const pageUrl = String(action.input.pageUrl);
  const host = new URL(pageUrl).hostname;
  if (!parsed.data.ok) {
    // Closing the browser is not a decision to skip the sign-in request.
    return NextResponse.json(owned.snapshot);
  }
  const cookies = parsed.data.cookies.filter((cookie) => belongsTo(cookie.domain, host));
  if (cookies.length === 0) return NextResponse.json({ error: `No session for ${host} was found. Finish signing in, then tap Done.` }, { status: 422 });
  const approved = await store.approveAction(action.id, id, owned.email);
  if (!approved) return NextResponse.json({ error: "This sign-in request is no longer pending." }, { status: 409 });
  const browser = getCloudBrowser(owned.email, id);
  let observationPending = false;
  try {
    const transferred = await transferSignInSession(() => browser.importCookies(owned.email, cookies.map((cookie) => ({
      name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || "/", secure: cookie.secure, httpOnly: cookie.httpOnly,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}), ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
    }))), () => browser.open(owned.email!, pageUrl), () => browser.endTakeoverStream(owned.email!));
    observationPending = transferred.observationPending;
    const page = transferred.page;
    await store.completeAction(approved.id, "executed", { sessionTransferred: true, host, cookieCount: cookies.length, observationPending, ...(page ? { title: page.title, url: page.url, snapshot: page.formatted } : {}) });
  } catch (error) {
    await store.completeAction(approved.id, "failed", { error: error instanceof Error ? error.message : "The signed-in session could not be transferred." });
    await resumeRun(store, id, `The sign-in to ${host} could not be transferred to the browser. Inspect the page and continue or report the blocker.`);
    return NextResponse.json(await store.getSnapshot(id), { status: 202 });
  }
  await resumeRun(store, id, `The user shared their session for ${host}. It was transferred to the cloud browser.${observationPending ? " The page observation failed after transfer; this does not mean sign-in failed." : " The page was reloaded."} Inspect the browser to verify the signed-in state and continue.`);
  return NextResponse.json(await store.getSnapshot(id), { status: 202 });
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
