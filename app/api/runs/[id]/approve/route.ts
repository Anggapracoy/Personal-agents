import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";

import { isConnectorConnected } from "../../../../../lib/composio/service";
import { emailDraftEditSchema } from "../../../../../lib/harness/email-draft-edit";
import { NextResponse } from "next/server";
import { resumeRun } from "../../../../../lib/harness/resume";
import { getRunStore } from "../../../../../lib/harness/store";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { getCloudBrowser } from "../../../../../lib/harness/browser/registry";
import { auth } from "../../../../../auth";
import { getGoogleConnectionAccessToken, getPrimaryGoogleConnectionId } from "../../../../../lib/auth/google-connections";
import { sensitiveApprovalCategoryForAction, setAlwaysApproved } from "../../../../../lib/approval-preferences";

async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { actionId?: string; mode?: "once" | "always"; emailEdit?: unknown; browserTakeoverDone?: boolean };
  if (body.mode !== undefined && body.mode !== "once" && body.mode !== "always") return NextResponse.json({ error: "Invalid approval mode." }, { status: 400 });
  const store = getRunStore();
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const snapshot = owned.snapshot;
  if (!snapshot || !owned.email) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  let action = body.browserTakeoverDone
    ? [...snapshot.actions].reverse().find((item) => item.status === "proposed" && item.toolName === "browser_request_takeover") ?? null
    : body.actionId ? await store.getAction(body.actionId, id) : [...snapshot.actions].reverse().find((item) => item.status === "proposed") ?? null;
  if (body.browserTakeoverDone && !action) {
    if (snapshot.status !== "running" || snapshot.actions.some(item => item.status === "proposed")) {
      return NextResponse.json({ error: "The task is waiting for a different response." }, { status: 409 });
    }
    try { await getCloudBrowser(owned.email, id).endTakeoverStream(owned.email); }
    catch { return NextResponse.json({ error: "The browser could not hand control back. Try again." }, { status: 409 }); }
    const latest = await store.getSnapshot(id);
    action = [...(latest?.actions ?? [])].reverse().find(item => item.status === "proposed" && item.toolName === "browser_request_takeover") ?? null;
    if (!action) {
      if (latest?.status !== "running" || latest.actions.some(item => item.status === "proposed")) {
        return NextResponse.json({ error: "The task is waiting for a different response." }, { status: 409 });
      }
      await store.updateRunMetadata(id, { manualTakeoverFinishedAt: new Date().toISOString() });
      return NextResponse.json(await store.getSnapshot(id));
    }
  }
  if (!action) return NextResponse.json({ error: "No pending action" }, { status: 409 });
  if (action.toolName === "apple_device") return NextResponse.json({ error: "Run this action in the Dash iPhone app." }, { status: 409 });
  const edit = body.emailEdit === undefined ? undefined : emailDraftEditSchema.safeParse(body.emailEdit);
  if (edit && (!edit.success || !["gmail_send_draft", "icloud_send_email"].includes(action.toolName))) return NextResponse.json({ error: "Enter a valid email subject and message." }, { status: 400 });
  const sensitiveCategory = sensitiveApprovalCategoryForAction(action.toolName, action.input);
  if (body.mode === "always" && sensitiveCategory === "email_send") return NextResponse.json({ error: "Every email requires explicit review." }, { status: 400 });
  if (body.mode === "always" && !sensitiveCategory) return NextResponse.json({ error: "Always approval is only available for purchases." }, { status: 400 });
  if (action.toolName === "vault_request_item") return NextResponse.json({ error: "Choose and unlock the requested login or card on your iPhone before continuing." }, { status: 409 });
  if (action.toolName === "vault_fill_login" || action.toolName === "vault_fill_payment") return NextResponse.json({ error: "Unlock this item with Face ID/password before continuing." }, { status: 409 });
  if (action.toolName === "connector_request_connection") {
    try {
      if (!await isConnectorConnected(owned.email, String(action.input.toolkit))) return NextResponse.json({ error: "Finish connecting this app before continuing." }, { status: 409 });
    } catch { return NextResponse.json({ error: "Couldn't verify the connection. Try again." }, { status: 502 }); }
  }
  let googleReconnect: { connectionId: string | null; accessToken: string } | null = null;
  if (action.toolName === "google_request_reconnect") {
    const session = await auth() as unknown as { accessToken?: string } | null;
    const executionContext = snapshot.metadata.executionContext as { sourceAccountId?: unknown } | undefined;
    const sourceAccountId = typeof executionContext?.sourceAccountId === "string" ? executionContext.sourceAccountId : null;
    const connectionId = sourceAccountId && sourceAccountId !== "session"
      ? sourceAccountId
      : await getPrimaryGoogleConnectionId(owned.email);
    const accessToken = connectionId ? await getGoogleConnectionAccessToken(owned.email, connectionId) : session?.accessToken;
    if (!accessToken) return NextResponse.json({ error: "Reconnect the source Google account before continuing." }, { status: 409 });
    googleReconnect = { connectionId, accessToken };
  }
  const waitingForUser = action.toolName === "browser_request_takeover" && action.input.mode === "wait_for_user";
  // Keep takeover pending if Continue is tapped on an expired browser. The
  // recovery page can then reopen it without falsely approving completion.
  let takeoverPage: Awaited<ReturnType<ReturnType<typeof getCloudBrowser>["snapshot"]>> | null = null;
  if (action.toolName === "browser_request_takeover") {
    try { takeoverPage = await getCloudBrowser(owned.email, id).snapshot(); }
    catch { if (!waitingForUser) return NextResponse.json({ error: "The browser is unavailable. Reopen it and finish the manual step before continuing." }, { status: 409 }); }
  }
  if (action.toolName === "browser_request_takeover" && !waitingForUser) {
    try { await getCloudBrowser(owned.email, id).endTakeoverStream(owned.email); }
    catch { return NextResponse.json({ error: "The browser could not hand control back. Try again." }, { status: 409 }); }
  }
  if (body.mode === "always" && sensitiveCategory) await setAlwaysApproved(owned.email, sensitiveCategory);
  const approved = await store.approveAction(action.id, id, owned.email, edit?.success ? edit.data : undefined);
  if (!approved) return NextResponse.json({ error: "Action is no longer pending" }, { status: 409 });

  if (action.toolName === "connector_request_connection") await store.completeAction(approved.id, "executed", { connected: true, toolkit: action.input.toolkit });
  if (action.toolName === "browser_request_takeover") {
    const page = takeoverPage;
    await store.completeAction(approved.id, "executed", { ...(waitingForUser ? { userReportedDone: true, resumedAfterUserWait: true } : { resumedAfterTakeover: true }), ...(page ? { title: page.title, url: page.url, snapshot: page.formatted } : { browserUnavailable: true }) });
  }
  if (action.toolName === "google_request_reconnect") {
    if (!googleReconnect) return NextResponse.json({ error: "Reconnect the source Google account before continuing." }, { status: 409 });
    if (googleReconnect.connectionId) await store.putSecret(id, "google_connection_id", googleReconnect.connectionId);
    await store.putSecret(id, "google_access_token", googleReconnect.accessToken);
    await store.completeAction(approved.id, "executed", { reconnected: true, account: owned.email });
  }
  const note = action.toolName === "connector_request_connection" ? `${String(action.input.name)} is now connected. Its active connection was verified by the server. Continue the user's task with connector_search and connector_execute.` : waitingForUser ? "The user reports finishing the requested step on their own device. Inspect the current browser state and verify the outcome before continuing; this is not proof of successful verification. If the browser session expired, recover it without repeating uncertain submissions."
    : action.toolName === "browser_request_takeover" ? "The user finished the manual step in the browser; the page was re-read. Inspect it and continue."
    : action.toolName === "google_request_reconnect" ? "Google was reconnected. Continue."
    : `The user approved: ${action.preview.split("\n")[0]}.${edit?.success ? " The user edited the draft; the send tool will apply their exact approved subject and body. Do not recreate or rewrite the draft." : ""} Call the same tool again with identical input to execute it.`;
  await resumeRun(store, id, note);
  return NextResponse.json(await store.getSnapshot(id));
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
