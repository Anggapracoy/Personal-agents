import postgres from "postgres";
import { NextRequest, NextResponse } from "next/server";
import { withRequestBodyLimit } from "../../../../lib/request-body-limit";
import { attachWhatsAppRun, claimWhatsAppMessage } from "../../../../lib/channels/whatsapp-ingress";
import { buildWhatsAppTextMessage, parseWhatsAppWebhook, verifyWhatsAppChallenge, verifyWhatsAppSignature } from "../../../../lib/channels/whatsapp";
import { getRunStore } from "../../../../lib/harness/store";
import { dispatchInteractiveRun } from "../../../../lib/harness/dispatch";

export const runtime = "nodejs";
export const maxDuration = 60;

declare global { var __anakbuahWhatsAppSql: ReturnType<typeof postgres> | undefined; }

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return globalThis.__anakbuahWhatsAppSql ??= postgres(url, { prepare: false, max: 4 });
}

export async function GET(request: NextRequest) {
  const challenge = verifyWhatsAppChallenge(
    request.nextUrl.searchParams.get("hub.mode"),
    request.nextUrl.searchParams.get("hub.verify_token"),
    request.nextUrl.searchParams.get("hub.challenge"),
    process.env.WHATSAPP_VERIFY_TOKEN,
  );
  return challenge === null ? NextResponse.json({ error: "Unauthorized." }, { status: 401 }) : new Response(challenge, { status: 200 });
}

async function POSTHandler(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const sql = database();
  if (!appSecret || !sql) return NextResponse.json({ error: "WhatsApp ingress is not configured." }, { status: 503 });
  const rawBody = await request.text();
  if (!verifyWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const messages = parseWhatsAppWebhook(payload);
  const store = getRunStore();
  let accepted = 0;
  let duplicates = 0;
  for (const message of messages) {
    const claim = await claimWhatsAppMessage(sql, message);
    if (claim.kind === "duplicate") { duplicates++; continue; }
    if (claim.kind !== "accepted") continue;
    const requestText = message.text.trim();
    const run = await store.createRun({
      userId: claim.ownerEmail,
      decisionId: null,
      category: "social",
      request: requestText,
      title: requestText.slice(0, 80) || "WhatsApp message",
      metadata: {
        sourceType: "whatsapp",
        channel: "whatsapp",
        whatsapp: { phoneNumberId: message.phoneNumberId, waId: message.from, providerMessageId: message.providerMessageId },
        userProfile: { email: claim.ownerEmail, name: claim.ownerEmail.split("@")[0] },
      },
    }, () => [
      { role: "user", content: requestText },
    ]);
    await attachWhatsAppRun(sql, message.providerMessageId, run.id);
    accepted++;
    try { await dispatchInteractiveRun(run.id, `whatsapp:${message.providerMessageId}`); }
    catch { console.warn("[whatsapp-ingress] durable dispatch deferred", { runId: run.id }); }
  }
  // The route currently acknowledges ingress only. Outbound delivery will be
  // added after run receipts and approval responses have a durable mapping.
  return NextResponse.json({ accepted, duplicates }, { status: 202 });
}

export const POST = withRequestBodyLimit(POSTHandler, 1_048_576);
