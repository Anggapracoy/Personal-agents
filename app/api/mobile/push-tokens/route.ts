import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserEmail } from "../../../../lib/auth/session";
import { registerPushDeviceToken, unregisterPushDeviceToken } from "../../../../lib/push-notifications";

export const runtime = "nodejs";

const deviceToken = z.string().trim().regex(/^[a-f0-9]{64,400}$/i);
const registration = z.object({
  token: deviceToken,
  environment: z.enum(["production", "sandbox"]),
});

export async function POST(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = registration.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid device token." }, { status: 400 });
  await registerPushDeviceToken({ ownerEmail: email, ...parsed.data });
  return NextResponse.json({ registered: true });
}

export async function DELETE(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = z.object({ token: deviceToken }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid device token." }, { status: 400 });
  return NextResponse.json({ removed: await unregisterPushDeviceToken(email, parsed.data.token) });
}
