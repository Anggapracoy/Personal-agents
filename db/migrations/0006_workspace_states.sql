CREATE TABLE IF NOT EXISTS workspace_states (
  owner_email text PRIMARY KEY,
  state_json jsonb NOT NULL,
  preferences_json jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_states_updated_idx
  ON workspace_states (updated_at DESC);

CREATE TABLE IF NOT EXISTS mobile_user_states (
  owner_email text PRIMARY KEY,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
