import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../../lib/auth/session";
import {
  claimInitialSignupScan,
  completeInitialSignupScan,
  requestInitialSignupScan,
  retryInitialSignupScan,
} from "../../../../../lib/workspace-state";

type InitialScanAction = "request" | "claim" | "complete" | "retry";

async function POSTHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  const action = body.action as InitialScanAction | undefined;

  if (action === "request") {
    return NextResponse.json({ requested: await requestInitialSignupScan(email) });
  }
  if (action === "claim") {
    return NextResponse.json({ claimed: await claimInitialSignupScan(email) });
  }
  if (action === "complete") {
    return NextResponse.json({ completed: await completeInitialSignupScan(email) });
  }
  if (action === "retry") {
    return NextResponse.json({ retryable: await retryInitialSignupScan(email) });
  }
  return NextResponse.json({ error: "Invalid initial scan action." }, { status: 400 });
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
