import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserEmail } from "../../../../../lib/auth/session";
import { getLifeProfile, saveLifePerson } from "../../../../../lib/life-profile";
import { personMemorySchema } from "../../../../../lib/people-memory";

const schema = z.object({ id: z.string().uuid().optional(), person: personMemorySchema });

async function POSTHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid person." }, { status: 400 });
  const saved = await saveLifePerson(email, parsed.data.person, parsed.data.id);
  if (!saved) return NextResponse.json({ error: "This person could not be found. Refresh and try again." }, { status: 404 });
  return NextResponse.json(await getLifeProfile(email), { headers: { "cache-control": "private, no-store" } });
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
