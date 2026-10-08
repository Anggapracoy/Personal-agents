import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../auth";
import { deliverPendingPushNotifications } from "../../../../lib/push-notifications";
import { answerEtaCheck } from "../../../../lib/proactive/engine/detectors/leave-now";

const etaSchema = z.object({
  checkId: z.string().uuid(),
  // Minutes only. The phone never sends where the user is.
  minutes: z.number().int().min(0).max(24 * 60).nullable(),
}).strict();

export async function POST(request: Request) {
  const session = await auth();
  const owner = session?.user?.email?.trim().toLowerCase();
  if (!owner) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = etaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid travel time." }, { status: 400 });
  const result = await answerEtaCheck(owner, parsed.data.checkId, parsed.data.minutes);
  if (result.candidate) await deliverPendingPushNotifications({ownerEmail:owner,includeRecent:true}).catch(()=>undefined);
  return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
}
