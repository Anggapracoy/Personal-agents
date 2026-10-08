CREATE TABLE IF NOT EXISTS manual_scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  active_key text,
  force_full_scan boolean NOT NULL DEFAULT false,
  user_time_zone text NOT NULL DEFAULT 'UTC',
  device_calendar_events_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_json jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_scan_jobs_active_key_uidx
  ON manual_scan_jobs (active_key);
CREATE INDEX IF NOT EXISTS manual_scan_jobs_owner_created_idx
  ON manual_scan_jobs (owner_email, created_at DESC);
