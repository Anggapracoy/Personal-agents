import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { agentApprovalPreferences } from "../db/schema";

export type SensitiveApprovalCategory = "email_send" | "purchase";

function normalizedOwnerEmail(value: string) {
  return value.trim().toLowerCase();
}

export function sensitiveApprovalCategoryForAction(toolName: string, input: Record<string, unknown>): SensitiveApprovalCategory | null {
  // A free-form endpoint/summary cannot establish a reusable email or purchase permission.
  if (toolName === "external_api_action") return null;
  if (toolName === "gmail_send_draft") return "email_send";
  if (input.approvalCategory === "email_send") return "email_send";
  if (input.approvalCategory === "purchase") return "purchase";
  if (/(?:send|reply).*email|email.*(?:send|reply)|gmail.*send/i.test(toolName)) return "email_send";
  if (/purchase|checkout|place[_ -]?order|\bbuy\b|\bpay\b|charge/i.test(toolName)) return "purchase";
  return null;
}

export async function isAlwaysApproved(ownerEmail: string, category: SensitiveApprovalCategory) {
  if (category === "email_send" || !process.env.DATABASE_URL) return false;
  const [row] = await getDb().select({ alwaysApprove: agentApprovalPreferences.alwaysApprove })
    .from(agentApprovalPreferences)
    .where(and(
      eq(agentApprovalPreferences.ownerEmail, normalizedOwnerEmail(ownerEmail)),
      eq(agentApprovalPreferences.category, category),
    )).limit(1);
  return row?.alwaysApprove === true;
}

export async function setAlwaysApproved(ownerEmail: string, category: SensitiveApprovalCategory) {
  if (category === "email_send") throw new Error("Every email requires explicit review.");
  const now = new Date();
  const [row] = await getDb().insert(agentApprovalPreferences).values({
    ownerEmail: normalizedOwnerEmail(ownerEmail),
    category,
    alwaysApprove: true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [agentApprovalPreferences.ownerEmail, agentApprovalPreferences.category],
    set: { alwaysApprove: true, updatedAt: now },
  }).returning();
  return row;
}
