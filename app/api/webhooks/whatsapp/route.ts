import postgres from "postgres";
import { NextRequest, NextResponse } from "next/server";
import { withRequestBodyLimit } from "../../../../lib/request-body-limit";
import { attachWhatsAppRun, claimWhatsAppMessage, findWhatsAppApproval, setWhatsAppConversationRun } from "../../../../lib/channels/whatsapp-ingress";
import { parseWhatsAppWebhook, verifyWhatsAppChallenge, verifyWhatsAppSignature } from "../../../../lib/channels/whatsapp";
import { classifyAnakbuahMessage } from "../../../../lib/channels/anakbuah-behavior";
import { getRunStore } from "../../../../lib/harness/store";
import { dispatchInteractiveRun } from "../../../../lib/harness/dispatch";
import { resumeRun } from "../../../../lib/harness/resume";

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
    const intent = classifyAnakbuahMessage(message);
    if (intent.kind === "approve" || intent.kind === "reject") {
      const target = await findWhatsAppApproval(sql, intent.approvalId, claim.ownerEmail);
      if (!target) continue;
      if (intent.kind === "approve") {
        const approved = await store.approveAction(intent.approvalId, target.runId, claim.ownerEmail);
        if (!approved) continue;
        await resumeRun(store, target.runId, `The user approved this action from WhatsApp. Call the same tool again with identical input to execute it.`);
      } else {
        const skipped = await store.skipAction(intent.approvalId, target.runId, claim.ownerEmail, { userDeniedApproval: true, instruction: "The user denied this action from WhatsApp. Do not perform it; continue without the external change." });
        if (!skipped) continue;
        await resumeRun(store, target.runId, `The user denied this action from WhatsApp. Do not perform or propose it again; continue without the external change.`);
      }
      await attachWhatsAppRun(sql, message.providerMessageId, target.runId);
      accepted++;
      continue;
    }
    const requestText = message.text.trim();
    if (claim.runId) {
      const acceptedReply = await store.acceptReply(claim.runId, { role: "user", content: requestText }, { channel: "whatsapp", whatsappMessageId: message.providerMessageId });
      if (acceptedReply !== "missing") {
        await attachWhatsAppRun(sql, message.providerMessageId, claim.runId);
        accepted++;
        if (acceptedReply === "started") {
          try { await dispatchInteractiveRun(claim.runId, `whatsapp:${message.providerMessageId}`); }
          catch { console.warn("[whatsapp-ingress] conversation dispatch deferred", { runId: claim.runId }); }
        }
        continue;
      }
    }
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
    await setWhatsAppConversationRun(sql, message.phoneNumberId, message.from, run.id);
    accepted++;
    try { await dispatchInteractiveRun(run.id, `whatsapp:${message.providerMessageId}`); }
    catch { console.warn("[whatsapp-ingress] durable dispatch deferred", { runId: run.id }); }
  }
  // The route currently acknowledges ingress only. Outbound delivery will be
  // added after run receipts and approval responses have a durable mapping.
  return NextResponse.json({ accepted, duplicates }, { status: 202 });
}

export const POST = withRequestBodyLimit(POSTHandler, 1_048_576);
