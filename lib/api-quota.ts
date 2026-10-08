import { securityDatabase } from './security-store';

const policies = {
  run: [[60_000, 4], [3_600_000, 40]],
  scan: [[60_000, 1], [3_600_000, 6], [86_400_000, 20]],
  upload: [[60_000, 5], [3_600_000, 30], [86_400_000, 100]],
  title: [[60_000, 6], [3_600_000, 60]],
  waitlist: [[60_000, 5], [3_600_000, 20]],
  reply: [[60_000, 30], [3_600_000, 300]],
  transcription: [[60_000, 20], [3_600_000, 120]],
  weather: [[60_000, 10], [3_600_000, 100]],
  handoff: [[60_000, 6], [3_600_000, 30]],
} as const;
const memory = new Map<string, { start: number; count: number }>();

/** Atomic across server instances; failed storage never bypasses the quota. */
export async function consumeApiQuota(email: string, kind: keyof typeof policies, database = securityDatabase(), now = Date.now()) {
  const owner = email.trim().toLowerCase();
  if (database) {
    const windows = policies[kind].map(([duration, limit]) => ({ duration, limit, start: Math.floor(now / duration) * duration }));
    const parameters: (string | number)[] = [];
    // Names and SQL structure come only from this fixed policy table. User
    // values remain bound parameters. Each window depends on the previous
    // result, preserving the existing short-circuit and charging order.
    const checks = windows.map(({ duration, limit, start }, index) => {
      const offset = parameters.length;
      parameters.push(owner, `${kind}:${duration}`, start, limit);
      return `q${index} as (insert into api_usage_buckets (owner_email,bucket,window_start,count)
        select $${offset + 1},$${offset + 2},$${offset + 3}::bigint,1
        ${index ? `where exists(select 1 from q${index - 1})` : ''}
        on conflict (owner_email,bucket) do update set window_start=excluded.window_start,
          count=case when api_usage_buckets.window_start=excluded.window_start then api_usage_buckets.count+1 else 1 end
        where api_usage_buckets.window_start<>excluded.window_start or api_usage_buckets.count<$${offset + 4}::integer
        returning count)`;
    });
    const [result] = await database.unsafe(`with ${checks.join(',')} select ${windows.map((_, index) => `exists(select 1 from q${index}) as allowed_${index}`).join(',')}`, parameters);
    const denied = windows.find((_, index) => !result[`allowed_${index}`]);
    return denied ? { allowed: false, retryAfter: Math.ceil((denied.start + denied.duration - now) / 1000) } : { allowed: true, retryAfter: 0 };
  }
  for (const [duration, limit] of policies[kind]) {
    const bucket = `${kind}:${duration}`;
    const start = Math.floor(now / duration) * duration;
    let allowed: boolean;
    {
      const key = `${owner}\0${bucket}`;
      const prior = memory.get(key);
      const entry = prior?.start === start ? prior : { start, count: 0 };
      allowed = entry.count < limit;
      if (allowed) entry.count++;
      memory.set(key, entry);
    }
    if (!allowed) return { allowed: false, retryAfter: Math.ceil((start + duration - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

export async function enforceApiQuota(email: string, kind: keyof typeof policies) {
  try {
    const result = await consumeApiQuota(email, kind);
    if (result.allowed) return null;
    return Response.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429, headers: { 'retry-after': String(result.retryAfter), 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Request limits are temporarily unavailable. Please try again shortly.' }, { status: 503 });
  }
}
