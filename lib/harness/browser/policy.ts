import { z } from "zod";
import type { BrowserElementDescription, BrowserSnapshot } from "./cloud";

const refSchema = z.string().regex(/^e\d{1,8}$/);
const roleTargetSchema = z.object({ role: z.string().min(1).max(60), name: z.string().min(1).max(240) });
// Some compatible providers encode a union's object branch as a JSON string.
// Decode data only, then apply exactly the same bounded locator schema.
const encodedObject = z.string().max(2000).regex(/^\s*\{/).transform((value, context) => {
  try { return JSON.parse(value) as unknown; }
  catch { context.addIssue({ code: "custom", message: "Target must be a valid locator object or element reference" }); return z.NEVER; }
});
const unscopedTargetSchema = z.union([refSchema, roleTargetSchema, encodedObject.pipe(roleTargetSchema)]);
const scopedTargetSchema = roleTargetSchema.extend({ within: unscopedTargetSchema.optional() });
export const browserTargetSchema = z.union([refSchema, scopedTargetSchema, encodedObject.pipe(scopedTargetSchema)])
  .describe("Use a real JSON object for role/name, not a quoted JSON string, or a current e-number ref. within scopes to one container. All matches must be unique.");
export type BrowserTarget = z.infer<typeof browserTargetSchema>;
export const browserApprovalSchema = z.boolean().describe("true for consequential submissions (sending, publishing, deleting, booking, purchasing or paying), including already-authorized actions, to track execution and prevent duplicates. Only email sends and purchases use the runtime confirmation gate. This flag does not imply payment. false for navigation, reversible preparation, cart edits and ordinary login submission.");

export function resolveBrowserTarget(target: BrowserTarget, page: BrowserSnapshot): string {
  if (typeof target === "string") {
    if (!page.elements.some(element => element.ref === target)) throw new Error("Stale browser reference. Inspect the current page before acting.");
    return target;
  }
  const scopeRef = target.within ? resolveBrowserTarget(target.within, page) : null;
  const matches = page.elements.filter(element => element.role === target.role && element.name === target.name && (!scopeRef || element.ancestorRefs?.includes(scopeRef)));
  if (matches.length !== 1) throw new Error(`Browser target matched ${matches.length} controls. Inspect and use the exact element ref to disambiguate.`);
  return matches[0].ref;
}

/** Narrow backstop, not a general-purpose action classifier. Intent comes from the model. */
export function browserApprovalBackstop(element: BrowserElementDescription): "purchase" | "transfer" | "send" | "booking" | "delete" | "account_change" | null {
  const name = (element.name ?? "").trim();
  // Tabs and shopping links are navigation; destructive links still need approval.
  if (element.role === "tab" || (element.tag === "a" && element.href && /^buy now$/i.test(name))) return null;
  if (/^(?:place (?:your )?order|pay(?: now| \S+)?|make payment|submit payment|buy now|confirm (?:purchase|payment)|complete purchase)$/i.test(name)) return "purchase";
  if (/^(?:transfer(?: money| funds)?|send money|wire(?: money| funds)?|confirm transfer)$/i.test(name)) return "transfer";
  if (/^(?:send|send message|send email|publish(?: post)?|post (?:comment|review))$/i.test(name)) return "send";
  if (/^(?:confirm (?:booking|reservation)|book now|reserve now)$/i.test(name)) return "booking";
  if (/^(?:delete|delete (?:account|file|message|event)|permanently delete(?: .+)?)$/i.test(name)) return "delete";
  if (/^(?:change password|save password|delete account|close account)$/i.test(name)) return "account_change";
  return null;
}

/** Enter can activate the form's default button while focus stays in a field.
 * Plain textarea Enter and native select/checkbox keys retain their normal meaning.
 */
export function browserKeyApprovalBackstop(element: BrowserElementDescription, key: string) {
  if (!["Enter", "Space"].includes(key.split("+").at(-1)!)) return null;
  const direct = browserApprovalBackstop(element);
  if (direct || key === "Space") return direct;
  const editorShortcut = key.endsWith("+Enter") && (element.tag === "textarea" || element.tag === "input" || element.isContentEditable || element.role === "textbox");
  if (!element.implicitSubmission && !editorShortcut) return null;
  const submitter = element.formSubmitter;
  const consequence = submitter ? browserApprovalBackstop(submitter) : null;
  if (consequence) return consequence;
  // Native GET form submission is navigation (e.g. search). Custom editor
  // shortcuts are not native form submission and cannot inherit that exemption.
  if (!editorShortcut && element.formMethod === "get") return null;
  return "implicit_submission" as const;
}
