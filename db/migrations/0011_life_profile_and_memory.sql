ALTER TABLE mobile_user_states
  ADD COLUMN IF NOT EXISTS onboarding_profile_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_life_profiles (
  owner_email text PRIMARY KEY,
  home_city text,
  home_country text,
  home_lat numeric,
  home_lng numeric,
  time_zone text,
  travel_mode text,
  travel_buffer_minutes integer,
  goals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_goal text,
  profile_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  kind text NOT NULL,
  stable_key text NOT NULL,
  value_json jsonb NOT NULL,
  source text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric NOT NULL DEFAULT 1,
  observed_at timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS life_facts_owner_stable_key_uidx
  ON life_facts (owner_email, stable_key);
CREATE INDEX IF NOT EXISTS life_facts_owner_active_idx
  ON life_facts (owner_email, superseded_at);
