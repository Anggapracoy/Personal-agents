import type { WhatsAppApprovalPayload, WhatsAppTextPayload } from "./whatsapp";

type WhatsAppSendPayload = WhatsAppTextPayload | WhatsAppApprovalPayload;
type Fetcher = typeof fetch;

export type WhatsAppClientConfig = {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
  fetcher?: Fetcher;
};

export type WhatsAppSendResult = { providerMessageId: string };

/** Send one already-approved provider payload. This client never decides whether an action is approved. */
export async function sendWhatsAppPayload(config: WhatsAppClientConfig, payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
  if (!config.accessToken || !config.phoneNumberId) throw new Error("WhatsApp delivery is not configured.");
  const version = config.graphVersion?.trim() || "v23.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid WhatsApp Graph API version.");
  const response = await (config.fetcher ?? fetch)(`https://graph.facebook.com/${version}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  const body = await response.json().catch(() => null) as { messages?: Array<{ id?: unknown }>; error?: { message?: unknown } } | null;
  if (!response.ok) throw new Error(typeof body?.error?.message === "string" ? `WhatsApp delivery failed: ${body.error.message}` : `WhatsApp delivery failed (${response.status}).`);
  const providerMessageId = body?.messages?.[0]?.id;
  if (typeof providerMessageId !== "string" || !providerMessageId) throw new Error("WhatsApp delivery returned no message ID.");
  return { providerMessageId };
}

