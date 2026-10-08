CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE source_type AS ENUM ('email', 'calendar', 'recurring', 'manual', 'proactive');
CREATE TYPE category AS ENUM ('schedule', 'money', 'food', 'family', 'shopping', 'travel', 'social');
CREATE TYPE urgency AS ENUM ('high', 'medium', 'low');
CREATE TYPE decision_status AS ENUM ('pending', 'chosen', 'dismissed', 'expired');
CREATE TYPE task_status AS ENUM ('running', 'needs_approval', 'completed', 'cancelled', 'failed');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  google_access_token text,
  google_refresh_token text,
  location_lat numeric,
  location_lng numeric,
  preferences_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_scan_at timestamptz
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  source_type source_type NOT NULL,
  source_id text,
  category category NOT NULL,
  urgency urgency NOT NULL,
  title text NOT NULL,
  subtitle text NOT NULL,
  options_json jsonb NOT NULL,
  dismiss_label text NOT NULL DEFAULT 'Not now',
  status decision_status NOT NULL DEFAULT 'pending',
  chosen_option_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  expires_at timestamptz
);

CREATE TABLE running_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  subtitle text NOT NULL,
  steps_json jsonb NOT NULL,
  current_step integer NOT NULL DEFAULT 0,
  draft_content text,
  status task_status NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  original_context text NOT NULL,
  chosen_option_label text NOT NULL,
  steps_taken jsonb NOT NULL,
  draft_sent text,
  outcome_summary text NOT NULL,
  money_saved_cents integer NOT NULL DEFAULT 0,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX decisions_feed_idx ON decisions(user_id, status, urgency, created_at DESC);
CREATE INDEX running_tasks_user_idx ON running_tasks(user_id, status, created_at DESC);
CREATE INDEX history_user_idx ON history(user_id, created_at DESC);
