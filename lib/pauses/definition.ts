import { z } from "zod";

export const DEFAULT_EMAIL_WAIT_MINUTES = 48 * 60;

const timestamp = z.string().datetime({ offset: true });
export const pauseConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), hours: z.number().int().min(0).max(8760), minutes: z.number().int().min(0).max(59) }),
  z.object({ type: z.literal("event"), event: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("gmail_reply"), timeoutMinutes: z.number().int().min(1).max(30 * 24 * 60).nullable().optional().describe("Fallback recheck deadline in minutes; null or omitted defaults to 48 hours. Choose a shorter wait for urgent work."), connectionId: z.string().uuid().nullable(), threadId: z.string().min(1).max(200), afterMessageId: z.string().min(1).max(200).nullable(), sender: z.string().email().nullable() }),
    z.object({ kind: z.literal("calendar_event_created"), connectionId: z.string().uuid().nullable(), title: z.string().trim().min(1).max(300), timeMin: timestamp, timeMax: timestamp }),
  ]) }),
]);
export const pauseSchema = z.object({ reason: z.string().trim().min(1).max(300), resumeInstructions: z.string().trim().min(1).max(4000), condition: pauseConditionSchema });
export const phonePauseSchema = z.object({ reason: z.string().min(1).max(300), resumeInstructions: z.string().min(1).max(4000), condition: z.object({ type: z.literal("phone_call"), callId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), actionId: z.string().uuid(), phoneNumber: z.string(), recipientName: z.string().max(120), status: z.enum(["queued", "in_progress"]) }) });
export type PhoneCallWait = z.infer<typeof phonePauseSchema>["condition"];
export type PauseDefinition = z.infer<typeof pauseSchema> | z.infer<typeof phonePauseSchema>;
export type EventCondition = Extract<PauseDefinition["condition"], { type: "event" }>["event"];
export type EventBaseline = { ids: string[]; since: string; accountEmail: string };
export type PauseDisplay = { id: string; ready: boolean; reason: string; wakeAt: string | null; eventKind: EventCondition["kind"] | "phone_call" | null; phoneCall?: PhoneCallWait };
export function validatePause(input: PauseDefinition, now = new Date()) {
  if (input.condition.type === "phone_call") return { definition: phonePauseSchema.parse(input), wakeAt: null };
  const value = pauseSchema.parse(input);
  if (value.condition.type === "time") {
    const minutes = value.condition.hours * 60 + value.condition.minutes;
    if (!minutes) throw new Error("Choose a duration of at least one minute.");
    return { definition: value, wakeAt: new Date(now.getTime() + minutes * 60_000).toISOString() };
  }
  const event = value.condition.event;
  if (event.kind === "gmail_reply") {
    return { definition: value, wakeAt: new Date(now.getTime() + (event.timeoutMinutes ?? DEFAULT_EMAIL_WAIT_MINUTES) * 60_000).toISOString() };
  }
  if (event.kind === "calendar_event_created") {
    const duration = Date.parse(event.timeMax) - Date.parse(event.timeMin);
    if (duration <= 0 || duration > 366 * 86400_000) throw new Error("Choose a calendar window between one second and one year.");
    if (Date.parse(event.timeMax) <= now.getTime()) throw new Error("The calendar window must end in the future.");
  }
  return { definition: value, wakeAt: null };
}
