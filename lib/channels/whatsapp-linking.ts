import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import type { WhatsAppInboundMessage } from "./whatsapp";

type Sql = ReturnType<typeof postgres>;

function codeHash(code: string) { return createHash("sha256").update(code).digest("hex"); }

export async function createWhatsAppLinkCode(sql: Sql, ownerEmail: string) {
  const code = randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await sql`insert into whatsapp_link_codes(code_hash,owner_email,expires_at) values (${codeHash(code)},${ownerEmail.trim().toLowerCase()},${expiresAt})`;
  return { code, expiresAt };
}

export async function redeemWhatsAppLinkCode(sql: Sql, message: WhatsAppInboundMessage): Promise<string | null> {
  const match = /^link\s+([a-f0-9]{8})$/i.exec(message.text.trim());
  if (!match) return null;
  return sql.begin(async transaction => {
    const tx = transaction as unknown as Sql;
    const [identity] = await tx`select owner_email from whatsapp_identities where phone_number_id=${message.phoneNumberId} and wa_id=${message.from} for update`;
    if (identity) return null;
    const [code] = await tx`select owner_email from whatsapp_link_codes where code_hash=${codeHash(match[1].toUpperCase())} and used_at is null and expires_at > now() for update`;
    if (!code || typeof code.owner_email !== "string") return null;
    const ownerEmail = code.owner_email.trim().toLowerCase();
    await tx`insert into whatsapp_identities(phone_number_id,wa_id,owner_email) values (${message.phoneNumberId},${message.from},${ownerEmail})`;
    await tx`update whatsapp_link_codes set used_at=now() where code_hash=${codeHash(match[1].toUpperCase())}`;
    await tx`update whatsapp_inbound_events set owner_email=${ownerEmail} where provider_message_id=${message.providerMessageId}`;
    return ownerEmail;
  }) as Promise<string | null>;
}
