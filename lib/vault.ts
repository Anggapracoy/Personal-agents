import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { consumerVaultItems } from "../db/schema";

export type VaultKind = "login" | "payment_card";

export type VaultItemSummary = {
  id: string;
  kind: VaultKind;
  label: string;
  siteHost: string | null;
  usernameHint: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  updatedAt: string;
};

function owner(value: string) { return value.trim().toLowerCase(); }

export function normalizeSiteHost(value: string | null | undefined) {
  const cleaned = value?.trim().toLowerCase() ?? "";
  if (!cleaned) return null;
  try {
    return new URL(cleaned.includes("://") ? cleaned : `https://${cleaned}`).hostname.replace(/^www\./, "");
  } catch {
    return cleaned.replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "").slice(0, 255) || null;
  }
}

function summary(row: typeof consumerVaultItems.$inferSelect): VaultItemSummary {
  const paymentCard = row.kind === "payment_card";
  return {
    id: row.id,
    kind: row.kind as VaultKind,
    label: paymentCard && /^payment card for .+/i.test(row.label) ? "Saved card" : row.label,
    // Older cards were stored with the merchant that first requested them.
    // Their Keychain secret is unchanged; only this legacy metadata is hidden.
    siteHost: paymentCard ? null : row.siteHost,
    usernameHint: row.usernameHint,
    cardBrand: row.cardBrand,
    cardLast4: row.cardLast4,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listVaultItems(ownerEmail: string) {
  const rows = await getDb().select().from(consumerVaultItems)
    .where(eq(consumerVaultItems.ownerEmail, owner(ownerEmail)))
    .orderBy(desc(consumerVaultItems.updatedAt));
  return rows.map(summary);
}

export async function saveVaultItemMetadata(input: {
  ownerEmail: string;
  id?: string;
  kind: VaultKind;
  label: string;
  siteHost?: string | null;
  usernameHint?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
}) {
  const now = new Date();
  const values = {
    ownerEmail: owner(input.ownerEmail),
    kind: input.kind,
    label: input.label.trim(),
    // Website logins are site scoped; payment cards are available at any
    // checkout after the user chooses and unlocks the card for that site.
    siteHost: input.kind === "payment_card" ? null : normalizeSiteHost(input.siteHost),
    usernameHint: input.kind === "login" ? input.usernameHint?.trim().slice(0, 320) || null : null,
    cardBrand: input.kind === "payment_card" ? input.cardBrand?.trim().slice(0, 32) || "Card" : null,
    cardLast4: input.kind === "payment_card" ? input.cardLast4?.replace(/\D/g, "").slice(-4) || null : null,
    // Explicitly null: this table is an index, never a secret store.
    encryptedPayload: null,
    updatedAt: now,
  };
  if (input.id) {
    const [updated] = await getDb().update(consumerVaultItems).set(values)
      .where(and(eq(consumerVaultItems.id, input.id), eq(consumerVaultItems.ownerEmail, owner(input.ownerEmail)), eq(consumerVaultItems.kind, input.kind)))
      .returning();
    if (!updated) throw new Error("Vault item was not found.");
    return summary(updated);
  }
  const [created] = await getDb().insert(consumerVaultItems).values({ ...values, createdAt: now }).returning();
  if (!created) throw new Error("Vault item metadata could not be saved.");
  return summary(created);
}

export async function deleteVaultItem(ownerEmail: string, id: string) {
  const rows = await getDb().delete(consumerVaultItems)
    .where(and(eq(consumerVaultItems.id, id), eq(consumerVaultItems.ownerEmail, owner(ownerEmail))))
    .returning({ id: consumerVaultItems.id });
  return Boolean(rows[0]);
}

export async function getVaultItemSummary(ownerEmail: string, id: string) {
  const [row] = await getDb().select().from(consumerVaultItems)
    .where(and(eq(consumerVaultItems.id, id), eq(consumerVaultItems.ownerEmail, owner(ownerEmail))))
    .limit(1);
  return row ? summary(row) : null;
}
