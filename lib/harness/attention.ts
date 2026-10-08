import type { AgentAction } from "./types";
import { checkoutDisplayTotal } from "../checkout-display";

const pauseTools = new Set(["connector_request_connection", "ask_questions", "browser_request_takeover", "browser_request_signin", "google_request_reconnect", "vault_request_item", "vault_fill_login", "vault_fill_payment"]);

/** A proposed device action is an automatic handoff, not an approval request. */
export function pendingAttentionAction(actions: AgentAction[]) {
  return [...actions].reverse().find(action => action.status === "proposed"
    && action.toolName !== "apple_device"
    && (action.risk === "write_external" || pauseTools.has(action.toolName)));
}

/** Describe the pending action without exposing credentials or copying page text. */
export function attentionNotificationBody(action: Pick<AgentAction, "toolName" | "input">) {
  const input = action.input;
  let host = "";
  const site = typeof input.pageUrl === "string" ? input.pageUrl : typeof input.siteHost === "string" ? input.siteHost : "";
  try {
    const url = new URL(site.includes("://") ? site : `https://${site}`);
    if (["http:", "https:"].includes(url.protocol)) host = url.hostname.replace(/^www\./, "");
  } catch { /* Missing site context: keep the action-specific wording. */ }
  const at = host ? ` at ${host}` : "";
  if (action.toolName === "vault_fill_payment") return `Unlock your card${at} to continue payment.`;
  if (action.toolName === "vault_fill_login") return `Unlock your saved login${at} to sign in.`;
  if (action.toolName === "vault_request_item") {
    if (input.kind === "payment_card") return `Choose a payment card${at} to continue.`;
    if (input.kind === "login") return `Choose a saved login${at} to sign in.`;
    return "Choose a saved login or payment card to continue.";
  }
  if (["browser_click", "browser_press"].includes(action.toolName) && (input.approvalCategory === "purchase" || ["purchase", "bill_payment", "transfer", "payment"].includes(String(input.approvalType)))) {
    const noun = input.approvalType === "bill_payment" ? "bill payment" : input.approvalType === "transfer" ? "transfer" : input.approvalType === "payment" ? "payment" : "order";
    const total = checkoutDisplayTotal(typeof input.purpose === "string" ? input.purpose : undefined);
    return `Approve your ${noun}${at}${total ? ` for ${total}` : ""}.`;
  }
  if (action.toolName === "connector_request_connection") return `Connect ${String(input.name ?? "the app")} so Dash can continue.`;
  if (action.toolName === "ask_questions") return "Answer a quick question so Dash can continue.";
  if (action.toolName === "browser_request_signin") return "Sign in so Dash can continue.";
  if (action.toolName === "browser_request_takeover") return input.mode === "wait_for_user" ? "Finish the step on your device, then tap Continue when done." : "Finish one step in the browser so Dash can continue.";
  if (action.toolName === "google_request_reconnect") return "Reconnect Google so Dash can continue.";
  return "Approve the next step so Dash can continue.";
}
