import type postgres from "postgres";
import type { WhatsAppInboundMessage } from "./whatsapp";

type Sql = ReturnType<typeof postgres>;

export type WhatsAppIngressClaim =
  | { kind: "duplicate" }
  | { kind: "unlinked" }
  | { kind: "accepted"; ownerEmail: string; runId: string | null };

/** Atomically authorize an identity and claim a provider delivery. */
export async function claimWhatsAppMessage(sql: Sql, message: WhatsAppInboundMessage): Promise<WhatsAppIngressClaim> {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    const [existing] = await tx`select provider_message_id from whatsapp_inbound_events where provider_message_id=${message.providerMessageId} limit 1`;
    if (existing) return { kind: "duplicate" };
    const [identity] = await tx`select owner_email,run_id from whatsapp_identities where phone_number_id=${message.phoneNumberId} and wa_id=${message.from} for update`;
    const ownerEmail = typeof identity?.owner_email === "string" ? identity.owner_email.trim().toLowerCase() : "";
    if (!ownerEmail) {
      await tx`insert into whatsapp_inbound_events(provider_message_id,phone_number_id,wa_id,body,received_at) values (${message.providerMessageId},${message.phoneNumberId},${message.from},${message.text},${message.receivedAt})`;
      return { kind: "unlinked" };
    }
    await tx`insert into whatsapp_inbound_events(provider_message_id,phone_number_id,wa_id,owner_email,body,received_at) values (${message.providerMessageId},${message.phoneNumberId},${message.from},${ownerEmail},${message.text},${message.receivedAt})`;
    return { kind: "accepted", ownerEmail, runId: typeof identity?.run_id === "string" ? identity.run_id : null };
  }) as Promise<WhatsAppIngressClaim>;
}

export async function attachWhatsAppRun(sql: Sql, providerMessageId: string, runId: string) {
  await sql`update whatsapp_inbound_events set run_id=${runId} where provider_message_id=${providerMessageId} and run_id is null`;
}

export async function setWhatsAppConversationRun(sql: Sql, phoneNumberId: string, waId: string, runId: string) {
  await sql`update whatsapp_identities set run_id=${runId} where phone_number_id=${phoneNumberId} and wa_id=${waId}`;
}

export async function findWhatsAppApproval(sql: Sql, actionId: string, ownerEmail: string): Promise<{ runId: string } | null> {
  const [row] = await sql`select a.run_id from agent_actions a join agent_runs r on r.id=a.run_id where a.id=${actionId} and a.status='proposed' and lower(r.user_id)=lower(${ownerEmail}) limit 1`;
  return typeof row?.run_id === "string" ? { runId: row.run_id } : null;
}
