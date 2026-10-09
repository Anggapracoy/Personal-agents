import type postgres from "postgres";
import type { WhatsAppInboundMessage } from "./whatsapp";

type Sql = ReturnType<typeof postgres>;

export type WhatsAppIngressClaim =
  | { kind: "duplicate" }
  | { kind: "unlinked" }
  | { kind: "accepted"; ownerEmail: string };

/** Atomically authorize an identity and claim a provider delivery. */
export async function claimWhatsAppMessage(sql: Sql, message: WhatsAppInboundMessage): Promise<WhatsAppIngressClaim> {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    const [existing] = await tx`select provider_message_id from whatsapp_inbound_events where provider_message_id=${message.providerMessageId} limit 1`;
    if (existing) return { kind: "duplicate" };
    const [identity] = await tx`select owner_email from whatsapp_identities where phone_number_id=${message.phoneNumberId} and wa_id=${message.from} for update`;
    const ownerEmail = typeof identity?.owner_email === "string" ? identity.owner_email.trim().toLowerCase() : "";
    if (!ownerEmail) {
      await tx`insert into whatsapp_inbound_events(provider_message_id,phone_number_id,wa_id,body,received_at) values (${message.providerMessageId},${message.phoneNumberId},${message.from},${message.text},${message.receivedAt})`;
      return { kind: "unlinked" };
    }
    await tx`insert into whatsapp_inbound_events(provider_message_id,phone_number_id,wa_id,owner_email,body,received_at) values (${message.providerMessageId},${message.phoneNumberId},${message.from},${ownerEmail},${message.text},${message.receivedAt})`;
    return { kind: "accepted", ownerEmail };
  }) as Promise<WhatsAppIngressClaim>;
}

export async function attachWhatsAppRun(sql: Sql, providerMessageId: string, runId: string) {
  await sql`update whatsapp_inbound_events set run_id=${runId} where provider_message_id=${providerMessageId} and run_id is null`;
}
