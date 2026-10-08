import test from "node:test";
import assert from "node:assert/strict";
import { attentionNotificationBody, pendingAttentionAction } from "../lib/harness/attention";
import type { AgentAction } from "../lib/harness/types";
const action = (toolName: string, risk = "read", status = "proposed") => ({ id: toolName, toolName, risk, status } as AgentAction);

test("automatic iPhone reads and writes never request approval by push", () => {
  for (const risk of ["read", "write_external"]) {
    assert.equal(pendingAttentionAction([action("apple_device", risk)]), undefined);
  }
});
test("a stale waiting snapshot cannot turn an in-flight search into an approval", () => {
  assert.equal(pendingAttentionAction([action("apple_device", "read", "executed"), action("web_search")]), undefined);
});
test("real user pauses still notify and are not masked by newer background work", () => {
  for (const name of ["ask_questions", "browser_request_signin", "browser_request_takeover", "google_request_reconnect", "vault_request_item", "vault_fill_login", "vault_fill_payment", "gmail_send_draft"]) {
    const pending = action(name, name === "gmail_send_draft" ? "write_external" : "read");
    assert.equal(pendingAttentionAction([pending, action("apple_device"), action("web_search")]), pending);
    assert.equal(pendingAttentionAction([{ ...pending, status: "executed" }]), undefined);
  }
});


test("card and login notifications describe selection versus unlock without secrets", () => {
  const input = { kind: "payment_card", siteHost: "www.example.com", password: "secret", securityCode: "123" };
  assert.equal(attentionNotificationBody({toolName: "vault_request_item", input}), "Choose a payment card at example.com to continue.");
  assert.equal(attentionNotificationBody({toolName: "vault_request_item", input: {...input, kind: "login"}}), "Choose a saved login at example.com to sign in.");
  assert.equal(attentionNotificationBody({toolName: "vault_fill_payment", input: {pageUrl: "https://example.com/checkout?secret=123"}}), "Unlock your card at example.com to continue payment.");
  assert.equal(attentionNotificationBody({toolName: "vault_fill_login", input: {}}), "Unlock your saved login to sign in.");
});

test("financial approvals use the selected action type and only an explicit total", () => {
  for (const toolName of ["browser_click", "browser_press"]) {
    for (const [approvalType, noun] of [["purchase", "order"], ["bill_payment", "bill payment"], ["transfer", "transfer"], ["payment", "payment"]]) {
      assert.equal(attentionNotificationBody({toolName, input: {approvalType, pageUrl: "https://shop.example/checkout", purpose: "CA$15.65 total"}}), `Approve your ${noun} at shop.example for CA$15.65.`);
    }
    assert.equal(attentionNotificationBody({toolName, input: {approvalCategory: "purchase", pageUrl: "invalid url", purpose: "CA$3.86 item; CA$15.65 total; CA$16.78 total"}}), "Approve your order.");
    assert.equal(attentionNotificationBody({toolName, input: {approvalType: "payment", purpose: "$10 item price"}}), "Approve your payment.");
    assert.equal(attentionNotificationBody({toolName, input: {requiresApproval: true}}), "Approve the next step so Dash can continue.");
  }
});
