import type { WhatsAppInboundMessage } from "./whatsapp";

export type AnakbuahIntent =
  | { kind: "message"; text: string }
  | { kind: "approve"; approvalId: string }
  | { kind: "reject"; approvalId: string }
  | { kind: "unknown"; text: string };

/** Small, deterministic channel mapping. Durable runtime execution comes later. */
export function classifyAnakbuahMessage(message: WhatsAppInboundMessage): AnakbuahIntent {
  const text = message.text.trim();
  const command = message.actionId ?? text;
  if (/^(approve|setuju):/i.test(command)) return { kind: "approve", approvalId: command.replace(/^(approve|setuju):/i, "") };
  if (/^(reject|tolak|batal):/i.test(command)) return { kind: "reject", approvalId: command.replace(/^(reject|tolak|batal):/i, "") };
  if (text) return { kind: "message", text };
  return { kind: "unknown", text: message.text };
}
