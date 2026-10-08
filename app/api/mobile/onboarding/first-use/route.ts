import { NextResponse } from 'next/server';
import { currentUserEmail } from '../../../../../lib/auth/session';
import { getDb } from '../../../../../db';
import { sql } from 'drizzle-orm';
import { hasUsefulResult } from '../../../../../lib/first-use-state';
export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const [scan] = await getDb().execute<{finished:boolean}>(sql`select initial_scan_completed_at is not null as finished from mobile_user_states where owner_email=${email}`);
  return NextResponse.json({ hasUsefulResult: await hasUsefulResult(email), initialScanFinished: Boolean(scan?.finished) }, { headers: { 'cache-control': 'private, no-store' } });
}
