import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { NextResponse } from "next/server";
import { resumeRun } from "../../../../../lib/harness/resume";
import { getCloudBrowser } from "../../../../../lib/harness/browser/registry";
import { getRunStore } from "../../../../../lib/harness/store";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { sensitiveApprovalCategoryForAction } from "../../../../../lib/approval-preferences";

const SKIPPABLE_ATTENTION_TOOLS = new Set([
  "connector_request_connection",
  "ask_questions",
  "browser_request_takeover",
  "browser_request_signin",
  "google_request_reconnect",
  "vault_request_item",
  "vault_fill_login",
  "vault_fill_payment",
]);

async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { actionId?: string };
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (owned.snapshot.status !== "awaiting_approval" && owned.snapshot.status !== "paused") {
    return NextResponse.json({ error: "This task is no longer waiting for you." }, { status: 409 });
  }

  const store = getRunStore();
  const action = body.actionId
    ? await store.getAction(body.actionId, id)
    : [...owned.snapshot.actions].reverse().find((candidate) => candidate.status === "proposed") ?? null;
  const sensitiveCategory = action ? sensitiveApprovalCategoryForAction(action.toolName, action.input) : null;
  const financialType = action && ["browser_click", "browser_press"].includes(action.toolName) && ["purchase", "bill_payment", "transfer", "payment"].includes(String(action.input.approvalType ?? "")) ? String(action.input.approvalType) : null;
  if (!action || action.status !== "proposed" || (!SKIPPABLE_ATTENTION_TOOLS.has(action.toolName) && !sensitiveCategory && !financialType)) {
    return NextResponse.json({ error: "This request cannot be skipped." }, { status: 409 });
  }

  const skipped = await store.skipAction(action.id, id, owned.email, {
    ...(sensitiveCategory || financialType ? { userDeniedApproval: true, ...(sensitiveCategory ? { approvalCategory: sensitiveCategory } : {}) } : { userSkipped: true }),
    instruction: sensitiveCategory || financialType
      ? `The user denied approval for this ${financialType?.replace(/_/g, " ") ?? (sensitiveCategory === "email_send" ? "email send" : "purchase")}. Do not perform or propose it again in this run. Finish without making that external change.`
      : "The user skipped this request and asked the agent to try a different route.",
  });
  if (!skipped) return NextResponse.json({ error: "This request is no longer waiting." }, { status: 409 });
  if (action.toolName === "browser_request_takeover") {
    await getCloudBrowser(owned.email, id).endTakeoverStream(owned.email).catch(() => undefined);
  }
  await resumeRun(store, id, sensitiveCategory ? `The user denied the ${sensitiveCategory === "email_send" ? "email send" : "purchase"}. Do not perform or propose it again; finish without that change.` : "The user skipped that request. Try a materially different route.");
  return NextResponse.json(await store.getSnapshot(id), { status: 202 });
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
