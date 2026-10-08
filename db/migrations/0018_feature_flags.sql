create table if not exists app_feature_flags (
  key text primary key,
  value jsonb not null,
  revision integer not null default 0,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
insert into app_feature_flags(key,value,updated_by)
values ('voice_calling','{"mode":"everyone","users":[]}'::jsonb,'migration')
on conflict (key) do nothing;
