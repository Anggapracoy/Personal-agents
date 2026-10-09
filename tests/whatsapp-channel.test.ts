import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { classifyAnakbuahMessage } from "../lib/channels/anakbuah-behavior";
import {
  buildWhatsAppApprovalMessage,
  buildWhatsAppTextMessage,
  parseWhatsAppWebhook,
  verifyWhatsAppChallenge,
  verifyWhatsAppSignature,
} from "../lib/channels/whatsapp";

test("verifies WhatsApp signature without accepting altered bodies", () => {
  const body = JSON.stringify({ hello: "anakbuah" });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(verifyWhatsAppSignature(body, signature, "secret"), true);
  assert.equal(verifyWhatsAppSignature(`${body}!`, signature, "secret"), false);
  assert.equal(verifyWhatsAppSignature(body, "sha256=bad", "secret"), false);
});

test("handles Meta webhook challenge and parses text plus approval buttons", () => {
  assert.equal(verifyWhatsAppChallenge("subscribe", "verify-me", "challenge", "verify-me"), "challenge");
  assert.equal(verifyWhatsAppChallenge("subscribe", "wrong", "challenge", "verify-me"), null);
  const messages = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-1" }, messages: [
    { id: "wamid.1", from: "62812", timestamp: "1700000000", text: { body: "tolong cek tiket" } },
    { id: "wamid.2", from: "62812", timestamp: "1700000001", interactive: { button_reply: { title: "Setuju", id: "approve:task-1" } } },
  ] } }] }] });
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.text, "tolong cek tiket");
  assert.equal(messages[1]?.kind, "button");
  assert.deepEqual(classifyAnakbuahMessage(messages[1]!), { kind: "approve", approvalId: "task-1" });
});

test("builds explicit text and approval payloads without sending them", () => {
  assert.deepEqual(buildWhatsAppTextMessage("62812", "Siap."), {
    messaging_product: "whatsapp", recipient_type: "individual", to: "62812", type: "text",
    text: { preview_url: false, body: "Siap." },
  });
  const approval = buildWhatsAppApprovalMessage("62812", "Booking ini?", "approve:1", "reject:1");
  assert.equal(approval.interactive.action.buttons[0]?.reply.id, "approve:1");
  assert.equal(approval.interactive.action.buttons[1]?.reply.title, "Tolak");
});
