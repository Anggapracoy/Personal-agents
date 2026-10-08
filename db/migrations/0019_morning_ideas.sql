-- One quiet personalized discovery pass per owner and LOCAL calendar day.
CREATE TABLE IF NOT EXISTS morning_idea_runs (
  owner_email text NOT NULL,
  local_date date NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  attempts integer NOT NULL DEFAULT 1,
  lease_until timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  report jsonb,
  error text,
  PRIMARY KEY (owner_email, local_date)
);
CREATE INDEX IF NOT EXISTS morning_idea_runs_recent_idx ON morning_idea_runs(owner_email, local_date DESC);

-- Independent of Calling. Preserve any deliberate policy on repeat migrations.
INSERT INTO app_feature_flags (key, value, revision, updated_by)
VALUES ('daily_proactive', '{"mode":"everyone","users":[]}'::jsonb, 0, 'migration')
ON CONFLICT (key) DO NOTHING;
