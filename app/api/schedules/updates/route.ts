import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../lib/auth/session";
import { getScheduleStore } from "../../../../lib/schedules/store";
import { getRunStore } from "../../../../lib/harness/store";

export async function GET(request: Request) {
  const owner = await currentUserEmail();
  if (!owner) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const since = new URL(request.url).searchParams.get("since");
  const [cutoff, afterId] = (since || "1970-01-01T00:00:00.000Z~00000000-0000-0000-0000-000000000000").split("~");
  if (!cutoff || !Number.isFinite(Date.parse(cutoff)) || !afterId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(afterId)) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  const sql = getScheduleStore().sql;
  const rows = await sql`select distinct r.id,r.updated_at,to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
    from agent_runs r
    where r.user_id=${owner} and (r.metadata->>'externalOrigin'='share' or exists(select 1 from scheduled_tasks s where s.run_id=r.id and s.owner_email=${owner}) or exists(select 1 from agent_pauses p where p.run_id=r.id and p.owner_email=${owner})) and (r.updated_at,r.id) > (${cutoff}::timestamptz,${afterId}::uuid)
    and not (coalesce(r.metadata->'scheduleExecution'->>'kind','')='check' and r.status in ('planning','running','done'))
    order by r.updated_at,r.id limit 100`;
  const snapshots = (await Promise.all(rows.map(row => getRunStore().getSnapshot(String(row.id))))).filter(Boolean);
  // Stable keyset pagination keeps simultaneous deliveries and large accounts from losing updates.
  const last = rows.at(-1);
  const cursor = last ? `${last.cursor_at}~${last.id}` : since || `${cutoff}~${afterId}`;
  return NextResponse.json({ snapshots, cursor }, { headers: { "cache-control": "private, no-store" } });
}
