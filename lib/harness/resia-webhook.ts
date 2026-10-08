import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getPauseStore } from "../pauses/store";
import { checkPhoneCall } from "./phone-monitor";
import { inngest } from "./inngest-client";

const eventSchema = z.object({ type: z.literal("call.ended"), call: z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }) });
type Dependencies = {
  webhookUrl?: string;
  find?: (callId: string) => Promise<Array<{ id: string; runId: string }>>;
  check?: typeof checkPhoneCall;
  resume?: (pauseId: string, runId: string) => Promise<unknown>;
};
export async function handleResiaWebhook(request: Request, deps: Dependencies = {}) {
  const webhookUrl = deps.webhookUrl ?? process.env.RESIA_CALL_ENDED_WEBHOOK_URL;
  const expected = webhookUrl ? new URL(webhookUrl).searchParams.get("token") : null;
  const supplied = new URL(request.url).searchParams.get("token");
  if (!expected || !supplied || expected.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Never trust outcomes in the unsigned webhook body. Re-read the matched call
  // using our API credential; the URL token only permits waking that check.
  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid event" }, { status: 400 });
  const pauses = await (deps.find ?? (id => getPauseStore().phoneCallsByProviderId(id)))(parsed.data.call.id);
  for (const pause of pauses) {
    const result = await (deps.check ?? checkPhoneCall)(pause.id);
    if (result.state === "ready") {
      await (deps.resume ?? ((pauseId, runId) => inngest.send({ name: "decision-feed/pause.ready", data: { pauseId, runId } })))(pause.id, pause.runId);
    }
  }
  // Early or duplicate deliveries are safe. The durable monitor/outbox remains
  // the fallback if delivery precedes checkpointing or event dispatch fails.
  return new Response(null, { status: 204 });
}
