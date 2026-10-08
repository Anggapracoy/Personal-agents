ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS result jsonb;

CREATE TABLE IF NOT EXISTS agent_run_secrets (
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  secret_key text NOT NULL,
  encrypted_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, secret_key)
);
