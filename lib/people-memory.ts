import { z } from "zod";

export const personMemorySchema = z.object({
  name: z.string().trim().min(1, "Add a name.").max(120),
  role: z.string().trim().max(160),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.").max(320)]),
  phone: z.string().trim().max(80).refine(value => !value || /^[+\d\s().#x-]+$/i.test(value) && value.replace(/\D/g, "").length >= 3, "Enter a valid phone number."),
});

export type PersonMemory = z.infer<typeof personMemorySchema>;

export const personMemoryUpdateSchema = z.object({
  operation: z.enum(["save", "remove"]).default("save").describe("Save adds or edits a person. Remove deletes the person with the supplied id; use only when the user asks to forget/remove them."),
  id: z.string().uuid().nullable().describe("Existing person ID from USER_LIFE_CONTEXT.people or a remember result. Null only when adding a new person."),
  name: personMemorySchema.shape.name.nullable().describe("Name; required for a new person. Null keeps the saved name when editing."),
  role: personMemorySchema.shape.role.nullable().describe("Role or relationship. Null keeps the saved value; empty string clears it."),
  // Zod's email regex uses lookarounds unsupported by model tool schemas.
  // The complete merged person is still validated by personMemorySchema before saving.
  email: z.string().trim().max(320).nullable().describe("Email address explicitly supplied by the user. Null keeps the saved value; empty string clears it."),
  phone: personMemorySchema.shape.phone.nullable().describe("Phone number explicitly supplied by the user. Null keeps the saved value; empty string clears it."),
});

export type PersonMemoryUpdate = z.infer<typeof personMemoryUpdateSchema>;

export function personFromMemory(value: Record<string, unknown>): PersonMemory | null {
  const result = personMemorySchema.safeParse(value);
  return result.success ? result.data : null;
}
