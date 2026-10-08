import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '../../../../auth';
import { proactiveEngineEnabled } from '../../../../lib/proactive/engine/candidates';
import { birthdayCandidates } from '../../../../lib/proactive/engine/detectors/birthdays';
import { deliverPendingPushNotifications } from '../../../../lib/push-notifications';

const birthdaySchema = z.object({ birthdays: z.array(z.object({ name: z.string().trim().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(20).default([]) });

/** Contacts supply discovery evidence; there is no wake-time delivery gate. */
export async function POST(request: Request) {
  const session = await auth();
  const owner = session?.user?.email?.trim().toLowerCase();
  if (!owner) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const parsed = birthdaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid birthday data.' }, { status: 400 });
  if (!await proactiveEngineEnabled(owner)) return NextResponse.json({ accepted: false });
  const created = await birthdayCandidates(owner, parsed.data.birthdays);
  if (created) await deliverPendingPushNotifications({ownerEmail:owner,includeRecent:true}).catch(()=>undefined);
  return NextResponse.json({ accepted: true, created }, { headers: {'cache-control':'private, no-store'} });
}
