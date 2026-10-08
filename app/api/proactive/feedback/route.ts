import { recordOpportunityFeedback } from "../../../../lib/proactive/opportunities";
import { proactivePublicationAllowed } from "../../../../lib/proactive/morning-access";
import { getDb } from "../../../../db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserEmail } from "../../../../lib/auth/session";
import { proactiveEngineEnabled } from "../../../../lib/proactive/engine/candidates";
import { senderAddress, topicKey } from "../../../../lib/proactive/engine/rules";
import { recordFeedback } from "../../../../lib/proactive/engine/store";
import { getWorkspaceState } from "../../../../lib/workspace-state";

const feedbackSchema = z.object({
  decisionId: z.string().min(1).max(200),
  kind: z.enum(["accepted", "dismissed", "less_like_this", "mute_sender", "not_a_loop"]),
}).strict();

/** Yes and no on suggestions teach Dash. The card's category, topic and sender come from the server copy. */
export async function POST(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });
  if (!await proactiveEngineEnabled(email)) return NextResponse.json({ recorded: false });
  const { state } = await getWorkspaceState(email);
  const decision = state.decisions.find(item => item.id === parsed.data.decisionId)
    ?? state.history.find(item => item.decisionId === parsed.data.decisionId)?.retryDecision;
  if (!decision || decision.sourceType === "manual") return NextResponse.json({ recorded: false });
  const sender = senderAddress(decision.executionContext?.sourceEmail?.from) || undefined;
  const recorded=await getDb().transaction(async tx=>{
    if(!await proactivePublicationAllowed(email,tx))return false;
    await recordFeedback(email, { kind: parsed.data.kind, category: decision.category, topic: topicKey(decision), sender },tx);
    await recordOpportunityFeedback(email, decision.id, parsed.data.kind,tx);
    return true;
  });
  return NextResponse.json({ recorded });
}
