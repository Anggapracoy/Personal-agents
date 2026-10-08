import { sql } from "drizzle-orm";
import { getDb } from "../db";

export type ConversationSearchMatch = { key: string; snippet: string };

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

/** A short excerpt centered on the first match, on word boundaries where possible. */
export function searchSnippet(text: string, query: string, width = 90) {
  const clean = text.replace(/\s+/g, " ").trim();
  const index = clean.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return clean.slice(0, width);
  const start = Math.max(0, index - Math.floor((width - query.length) / 2));
  const end = Math.min(clean.length, start + width);
  let excerpt = clean.slice(start, end);
  if (start > 0) excerpt = `…${excerpt.replace(/^\S*\s/, "")}`;
  if (end < clean.length) excerpt = `${excerpt.replace(/\s\S*$/, "")}…`;
  return excerpt;
}

/**
 * Searches the whole conversation, not only its title and last message: every visible message,
 * the original request, the result receipt (confirmation numbers, totals) and attached file names.
 */
export async function searchConversations(ownerEmail: string, query: string, db = getDb()): Promise<ConversationSearchMatch[]> {
  const needle = query.trim().slice(0, 100);
  if (needle.length < 2) return [];
  const owner = ownerEmail.trim().toLowerCase();
  const pattern = likePattern(needle);
  const rows = await db.execute<{ key: string; text: string; at: string }>(sql`
    with runs as (
      select r.id, r.decision_id, r.title, r.request, r.metadata, r.result, r.updated_at,
        coalesce('decision:' || r.decision_id, 'run:' || r.id::text) as key
      from agent_runs r where r.user_id=${owner}
    ), candidates as (
      select runs.key, t.body as text, m.created_at as at
      from runs join agent_messages m on m.run_id=runs.id
      cross join lateral (select case
        when jsonb_typeof(m.message->'content')='string' then m.message->>'content'
        when jsonb_typeof(m.message->'content')='array' then
          coalesce((select string_agg(part->>'text', ' ' order by ordinal)
            from jsonb_array_elements(m.message->'content') with ordinality as parts(part,ordinal)
            where part->>'type'='text' and part->>'text' not like '[attachment context]%'
              and part->>'text' not like '[reply context]%'), '')
        else '' end as body) t
      where m.message->>'role' in ('user','assistant') and t.body not like '[runtime]%' and t.body ilike ${pattern}
      union all
      select key, coalesce(metadata->>'userMessage', request), updated_at from runs
      where coalesce(metadata->>'userMessage', request) ilike ${pattern} or title ilike ${pattern}
      union all
      select key, result::text, updated_at from runs where result is not null and result::text ilike ${pattern}
      union all
      select runs.key, regexp_replace(a.name, '^uploaded-[0-9a-f-]{36}-', ''), a.created_at
      from runs join agent_artifacts a on a.run_id=runs.id
      where regexp_replace(a.name, '^uploaded-[0-9a-f-]{36}-', '') ilike ${pattern}
    )
    select distinct on (key) key, text, at from candidates
    order by key, at desc
  `);
  return rows
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 50)
    .map(row => ({ key: row.key, snippet: searchSnippet(readableText(row.text), needle) }));
}

/** Receipts are JSON; show their values, not their structure. */
function readableText(text: string) {
  if (!text.startsWith("{") && !text.startsWith("[")) return text;
  try {
    const values: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string" || typeof value === "number") values.push(String(value));
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(JSON.parse(text));
    return values.join(" · ");
  } catch {
    return text;
  }
}
