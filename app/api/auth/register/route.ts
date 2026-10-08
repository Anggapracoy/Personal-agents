import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Email/password signup is disabled. Continue with Google." },
    { status: 403 },
  );
}
