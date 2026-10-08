export type FinancialApprovalType = "purchase" | "bill_payment" | "transfer" | "payment";

/** These controls perform a non-money action, even when the model supplies a money type. */
export function nonFinancialControl(control: string): boolean {
  return /^(?:delete(?:\s.*)?|move to (?:trash|bin)|trash|archive|sign[ -]?in|log[ -]?in)$/i.test(control.trim());
}

/** Classify the consequence, not the merchant's often ambiguous button copy alone. */
export function financialApprovalType(control: string, purpose: string, requested?: FinancialApprovalType): FinancialApprovalType | null {
  if (nonFinancialControl(control)) return null;
  const bill = /\b(?:pay|payment|settle)\b.{0,80}\b(?:bill|invoice|utility|utilities|tax)\b|\b(?:bill|invoice|utility|utilities|tax)\b.{0,80}\b(?:pay|payment|settle)\b/i;
  const transfer = /\b(?:transfer|wire|send money|move money)\b/i;
  if (requested && bill.test(`${control} ${purpose}`) && requested !== "bill_payment") throw new Error("This action pays a bill. Choose bill_payment for its approval header.");
  if (requested && transfer.test(`${control} ${purpose}`) && requested !== "transfer") throw new Error("This action transfers money. Choose transfer for its approval header.");
  if (requested && reusablePurchaseControl(control) && requested !== "purchase") throw new Error("This control places an order. Choose purchase for its approval header.");
  if (requested) return requested;
  const text = `${control} ${purpose}`;
  if (bill.test(text)) return "bill_payment";
  if (transfer.test(text)) return "transfer";
  if (/\b(?:place (?:your )?order|buy now|complete purchase|confirm purchase)\b/i.test(text)) return "purchase";
  if (/\b(?:pay|payment|charge)\b/i.test(text)) return "payment";
  return null;
}

/** An ambiguous Pay button cannot inherit an existing purchase Approve always preference. */
export function reusablePurchaseControl(control: string) {
  return /^(?:place (?:your )?order|buy now|complete purchase|confirm purchase)$/i.test(control.trim());
}
