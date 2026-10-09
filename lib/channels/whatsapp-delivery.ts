import postgres from "postgres";
import { buildWhatsAppApprovalMessage, buildWhatsAppTextMessage } from "./whatsapp";
import { sendWhatsAppPayload } from "./whatsapp-client";

declare global { var __anakbuahWhatsAppDeliverySql: ReturnType<typeof postgres> | undefined; }

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return globalThis.__anakbuahWhatsAppDeliverySql ??= postgres(url, { prepare: false, max: 4 });
}

export async function deliverWhatsAppNotification(input: {
  runId: string;
  deliveryKey: string;
  body: string;
  approvalId?: string;
}) {
  const sql = database();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!sql || !accessToken || !input.body.trim()) return false;
  return sql.begin(async transaction => {
    const tx = transaction as unknown as ReturnType<typeof postgres>;
    await tx`select pg_advisory_xact_lock(hashtextextended(${input.deliveryKey}, 0))`;
    const [existing] = await tx`select status from whatsapp_outbound_deliveries where delivery_key=${input.deliveryKey} limit 1`;
    if (existing?.status === "sent" || existing?.status === "sending") return false;
    const [target] = await tx`select phone_number_id, wa_id from whatsapp_inbound_events where run_id=${input.runId} order by created_at desc limit 1`;
    if (!target?.phone_number_id || !target?.wa_id) return false;
    await tx`insert into whatsapp_outbound_deliveries(delivery_key,run_id,to_wa_id,phone_number_id,status) values (${input.deliveryKey},${input.runId},${target.wa_id},${target.phone_number_id},'sending') on conflict(delivery_key) do update set status='sending',last_error=null`;
    const payload = input.approvalId
      ? buildWhatsAppApprovalMessage(String(target.wa_id), input.body, `approve:${input.approvalId}`, `reject:${input.approvalId}`)
      : buildWhatsAppTextMessage(String(target.wa_id), input.body);
    try {
      const sent = await sendWhatsAppPayload({ accessToken, phoneNumberId: String(target.phone_number_id), graphVersion: process.env.WHATSAPP_GRAPH_VERSION }, payload);
      await tx`update whatsapp_outbound_deliveries set status='sent',provider_message_id=${sent.providerMessageId},sent_at=now(),last_error=null where delivery_key=${input.deliveryKey}`;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "WhatsApp delivery failed.";
      await tx`update whatsapp_outbound_deliveries set status='failed',last_error=${message} where delivery_key=${input.deliveryKey}`;
      throw error;
    }
  }) as Promise<boolean>;
}
