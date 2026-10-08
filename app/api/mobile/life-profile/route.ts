import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserEmail } from "../../../../lib/auth/session";
import { LIFE_GOALS, TRAVEL_MODES, getLifeProfile, updateLifeProfile } from "../../../../lib/life-profile";

const updateSchema = z.object({
  homeCity: z.string().trim().max(160).nullable().optional(),
  travelMode: z.enum(TRAVEL_MODES).nullable().optional(),
  travelBufferMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).nullable().optional(),
  goals: z.array(z.enum(LIFE_GOALS)).max(LIFE_GOALS.length).optional(),
  customGoal: z.string().trim().max(280).nullable().optional(),
  customInstructions: z.string().trim().max(4000).nullable().optional(),
  source: z.enum(["onboarding", "settings"]).optional(),
});

export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json(await getLifeProfile(email), { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const raw = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid life profile.", issues: parsed.error.issues }, { status: 400 });
  const { source, ...patch } = parsed.data;
  return NextResponse.json(await updateLifeProfile(email, patch, source ?? "onboarding"), {
    headers: { "cache-control": "private, no-store" },
  });
}
