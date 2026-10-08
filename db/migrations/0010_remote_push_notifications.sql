CREATE TABLE IF NOT EXISTS push_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  token text NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  enabled boolean NOT NULL DEFAULT true,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_device_tokens_token_uidx
  ON push_device_tokens (token);
CREATE INDEX IF NOT EXISTS push_device_tokens_owner_enabled_idx
  ON push_device_tokens (owner_email, enabled);

CREATE TABLE IF NOT EXISTS push_notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  decision_id text NOT NULL,
  title text NOT NULL,
  subtitle text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_notification_jobs_owner_decision_uidx
  ON push_notification_jobs (owner_email, decision_id);
CREATE INDEX IF NOT EXISTS push_notification_jobs_status_updated_idx
  ON push_notification_jobs (status, updated_at);
