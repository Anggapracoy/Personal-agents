import { z } from "zod";

// Server APIs deliberately accept metadata only. Secret fields are rejected
// by the strict object schemas before they can reach application storage.
export const vaultMetadataSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("login"),
    label: z.string().trim().min(1).max(120),
    siteHost: z.string().trim().max(255).nullable().optional(),
    usernameHint: z.string().trim().min(1).max(320),
  }),
  z.strictObject({
    kind: z.literal("payment_card"),
    label: z.string().trim().min(1).max(120),
    siteHost: z.string().trim().max(255).nullable().optional(),
    cardBrand: z.string().trim().min(1).max(32),
    cardLast4: z.string().regex(/^\d{4}$/),
  }),
]);
