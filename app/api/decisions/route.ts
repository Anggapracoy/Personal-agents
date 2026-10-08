import { withRequestBodyLimit } from "../../../lib/request-body-limit";
import { NextResponse } from "next/server";
import { generateDecisionCard } from "../../../lib/agent";
import { currentUserEmail } from "../../../lib/auth/session";
import { createTemporalContext } from "../../../lib/temporal";
import { getLifeProfile } from "../../../lib/life-profile";

async function POSTHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { question?: string; userTimeZone?: unknown };
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "A decision question is required." }, { status: 400 });
  const lifeMemory = await getLifeProfile(email);
  const card = await generateDecisionCard(question, lifeMemory, createTemporalContext(body.userTimeZone), email);
  const { temporalStatus, relevantDateTime, unresolvedPastConsequence: _unresolvedPastConsequence, ...decision } = card;
  return NextResponse.json({
    ...decision,
    id: `manual-${Date.now()}`,
    sourceType: "manual",
    originalContext: "You added this decision directly.",
    dismissLabel: "Remove this decision",
    createdAt: new Date().toISOString(),
    actionableUntil: temporalStatus !== "past_resolved" && relevantDateTime && Date.parse(relevantDateTime) > Date.now()
      ? new Date(relevantDateTime).toISOString()
      : undefined,
  });
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
