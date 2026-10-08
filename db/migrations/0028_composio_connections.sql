create table if not exists composio_sessions (
  owner_email text primary key,
  session_id text not null,
  enabled_toolkits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table composio_sessions add column if not exists runtime_session_id text;
alter table composio_sessions add column if not exists runtime_fingerprint text;
