import { z } from "zod";

export const callingPolicySchema = z.object({
  mode: z.enum(["everyone", "selected", "none"]),
  users: z.array(z.object({ email: z.string().trim().toLowerCase().email().max(320), enabled: z.boolean() })).max(5000),
  revision: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if (new Set(value.users.map(user => user.email)).size !== value.users.length) ctx.addIssue({ code: "custom", path: ["users"], message: "Each email can appear only once." });
});
export type CallingPolicy = z.infer<typeof callingPolicySchema>;
export const defaultCallingPolicy: CallingPolicy = { mode: "everyone", users: [], revision: 0 };

export function callingEnabled(policy: CallingPolicy, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized || policy.mode === "none") return false;
  const override = policy.users.find(user => user.email === normalized);
  return override ? override.enabled : policy.mode === "everyone";
}
