import { withRequestBodyLimit } from "../../../../lib/request-body-limit";

import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../lib/auth/session";
import { LIFE_PROFILE_VERSION } from "../../../../lib/life-profile";
import { getOnboardingStatus, setOnboardingCompleted } from "../../../../lib/workspace-state";

export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const status = await getOnboardingStatus(email);
  return NextResponse.json({
    completed: status.completed,
    profileVersion: status.profileVersion,
    requiredProfileVersion: LIFE_PROFILE_VERSION,
    needsProfileSetup: status.profileVersion < LIFE_PROFILE_VERSION,
  }, {
    headers: { "cache-control": "private, no-store" },
  });
}

async function PATCHHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { completed?: unknown };
  if (typeof body.completed !== "boolean") return NextResponse.json({ error: "Invalid onboarding state." }, { status: 400 });
  const completed = await setOnboardingCompleted(email,body.completed);

  return NextResponse.json({completed});
}

export const PATCH = withRequestBodyLimit(PATCHHandler, 1048576);
