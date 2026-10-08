import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '../../../../db';
import { currentUserEmail } from '../../../../lib/auth/session';
import { sameOrigin } from '../../../../lib/http-security';
export async function GET(request: Request) {
  const native = new URL(request.url).searchParams.get("native") === "1";
  const owner = await currentUserEmail();
  if (!owner) return NextResponse.json({ seen: true }, { status: 401 });
  const [row] = await getDb().execute<{ seen: boolean; eligible: boolean }>(sql`select
    coalesce(preferences_json->>'firstSuggestionsHintSeen','false')='true'
    or jsonb_array_length(coalesce(state_json->'history','[]'::jsonb))>0
    or jsonb_array_length(coalesce(state_json->'tasks','[]'::jsonb))>0 as seen,
    (${!native} or coalesce((select onboarding_completed from mobile_user_states where owner_email=${owner}),false)) as eligible
    from workspace_states where owner_email=${owner}`);
  return NextResponse.json({ seen: row?.seen ?? false, eligible: row?.eligible ?? !native }, { headers: { 'cache-control': 'private, no-store' } });
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const owner = await currentUserEmail(); if (!owner) return new NextResponse(null, { status: 401 });
  const native = new URL(request.url).searchParams.get("native") === "1";
  const rows = await getDb().execute(sql`update workspace_states set preferences_json=jsonb_set(preferences_json,'{firstSuggestionsHintSeen}','true'::jsonb,true),version=version+1,updated_at=now() where owner_email=${owner} and coalesce(preferences_json->>'firstSuggestionsHintSeen','false')<>'true'
    and (${!native} or coalesce((select onboarding_completed from mobile_user_states where owner_email=${owner}),false)) returning owner_email`);
  return NextResponse.json({ seen: true, claimed: rows.length > 0 });
}
