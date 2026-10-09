import { createHmac, timingSafeEqual } from "node:crypto";

export type WhatsAppInboundMessage = {
  providerMessageId: string;
  from: string;
  receivedAt: Date;
  phoneNumberId: string;
  kind: "text" | "button" | "list";
  text: string;
  actionId?: string;
  replyToMessageId?: string;
};

export type WhatsAppTextPayload = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { preview_url: false; body: string };
};

export type WhatsAppApprovalPayload = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "button";
    body: { text: string };
    action: {
      buttons: Array<{
        type: "reply";
        reply: { id: string; title: string };
      }>;
    };
  };
};

/** Verify Meta's X-Hub-Signature-256 header against the exact request body. */
export function verifyWhatsAppSignature(rawBody: string, signature: string | null, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const supplied = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

/** Return the challenge only when Meta's verify token matches. */
export function verifyWhatsAppChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedToken: string | undefined,
): string | null {
  if (mode !== "subscribe" || !token || !challenge || !expectedToken) return null;
  const supplied = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return challenge;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseMessage(message: Record<string, unknown>, phoneNumberId: string): WhatsAppInboundMessage | null {
  const id = stringValue(message.id);
  const from = stringValue(message.from);
  if (!id || !from) return null;
  const timestamp = stringValue(message.timestamp);
  const receivedAt = timestamp && /^\d+$/.test(timestamp) ? new Date(Number(timestamp) * 1000) : new Date();
  if (Number.isNaN(receivedAt.getTime())) return null;

  const context = asRecord(message.context);
  const replyToMessageId = stringValue(context?.id) ?? undefined;
  const text = asRecord(message.text);
  const button = asRecord(message.button);
  const interactive = asRecord(message.interactive);
  const buttonReply = asRecord(interactive?.button_reply);
  const listReply = asRecord(interactive?.list_reply);
  const textBody = stringValue(text?.body);
  if (textBody) return { providerMessageId: id, from, receivedAt, phoneNumberId, kind: "text", text: textBody, replyToMessageId };
  const buttonText = stringValue(button?.text) ?? stringValue(buttonReply?.title);
  const buttonId = stringValue(button?.payload) ?? stringValue(buttonReply?.id);
  if (buttonText) return { providerMessageId: id, from, receivedAt, phoneNumberId, kind: "button", text: buttonText, actionId: buttonId ?? undefined, replyToMessageId };
  const listText = stringValue(listReply?.title);
  const listId = stringValue(listReply?.id);
  if (listText) return { providerMessageId: id, from, receivedAt, phoneNumberId, kind: "list", text: listText, actionId: listId ?? undefined, replyToMessageId };
  return null;
}

/** Extract user messages from a Cloud API webhook; status/read events are ignored. */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppInboundMessage[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const messages: WhatsAppInboundMessage[] = [];
  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const changeValue of changes) {
      const change = asRecord(changeValue);
      const value = asRecord(change?.value);
      const metadata = asRecord(value?.metadata);
      const phoneNumberId = stringValue(metadata?.phone_number_id);
      if (!phoneNumberId || !Array.isArray(value?.messages)) continue;
      for (const messageValue of value.messages) {
        const message = asRecord(messageValue);
        const parsed = message ? parseMessage(message, phoneNumberId) : null;
        if (parsed) messages.push(parsed);
      }
    }
  }
  return messages;
}

export function buildWhatsAppTextMessage(to: string, body: string): WhatsAppTextPayload {
  if (!to || !body.trim()) throw new Error("WhatsApp recipient and message body are required.");
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } };
}

export function buildWhatsAppApprovalMessage(
  to: string,
  body: string,
  approveId: string,
  rejectId: string,
): WhatsAppApprovalPayload {
  if (!to || !body.trim() || !approveId || !rejectId) throw new Error("WhatsApp approval fields are required.");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: [
        { type: "reply", reply: { id: approveId, title: "Setuju" } },
        { type: "reply", reply: { id: rejectId, title: "Tolak" } },
      ] },
    },
  };
}
