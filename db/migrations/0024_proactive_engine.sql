-- Proactive engine v2. Enabled per user by the existing daily_proactive flag.

-- Everything Dash might tell the user, with when and how it may be delivered.
CREATE TABLE IF NOT EXISTS proactive_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  kind text NOT NULL,
  dedupe_key text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('now','natural','moment','silent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','bundled','suppressed','resolved','expired')),
  decision_id text,
  title text NOT NULL,
  body text NOT NULL,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pushed boolean NOT NULL DEFAULT false,
  deliver_after timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_email, dedupe_key)
);
CREATE INDEX IF NOT EXISTS proactive_candidates_pending_idx ON proactive_candidates(owner_email, status, deliver_after);

-- One row per buzz so caps count real interruptions in the user's local day.
CREATE TABLE IF NOT EXISTS proactive_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  local_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('now','moment','bundle')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proactive_deliveries_day_idx ON proactive_deliveries(owner_email, local_date);

-- Moments reported by the iPhone. Never raw coordinates or location history.
CREATE TABLE IF NOT EXISTS proactive_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('arrived','left','airport','landed')),
  place_label text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proactive_moments_recent_idx ON proactive_moments(owner_email, occurred_at DESC);

CREATE TABLE IF NOT EXISTS proactive_preferences (
  owner_email text PRIMARY KEY,
  quiet_start smallint NOT NULL DEFAULT 22 CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end smallint NOT NULL DEFAULT 8 CHECK (quiet_end BETWEEN 0 AND 23),
  max_buzzes smallint NOT NULL DEFAULT 3 CHECK (max_buzzes BETWEEN 0 AND 10),
  muted_senders jsonb NOT NULL DEFAULT '[]'::jsonb,
  muted_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_feedback jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_wake_at timestamptz,
  upcoming_birthdays jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Leave-now checks ask the phone for an ETA; the phone answers with minutes only.
CREATE TABLE IF NOT EXISTS proactive_eta_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  event_key text NOT NULL,
  event_title text NOT NULL,
  destination text NOT NULL,
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','answered','failed')),
  minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  UNIQUE (owner_email, event_key)
);

-- Also safe when the initial v2 migration has already been applied.
ALTER TABLE proactive_eta_checks ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE proactive_eta_checks ADD COLUMN IF NOT EXISTS last_requested_at timestamptz;
