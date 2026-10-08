CREATE TABLE IF NOT EXISTS google_source_watches (
  connection_id uuid PRIMARY KEY REFERENCES connected_google_accounts(id) ON DELETE CASCADE,
  owner_email text NOT NULL,
  account_email text NOT NULL,
  gmail_history_id text,
  gmail_watch_expires_at timestamptz,
  calendar_channel_id text,
  calendar_resource_id text,
  calendar_watch_expires_at timestamptz,
  last_gmail_notification_at timestamptz,
  last_calendar_notification_at timestamptz,
  last_processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_source_watches_calendar_channel_uidx
  ON google_source_watches (calendar_channel_id);
CREATE INDEX IF NOT EXISTS google_source_watches_account_email_idx
  ON google_source_watches (account_email);
CREATE INDEX IF NOT EXISTS google_source_watches_expiration_idx
  ON google_source_watches (gmail_watch_expires_at, calendar_watch_expires_at);

CREATE TABLE IF NOT EXISTS discovery_scan_states (
  user_key text PRIMARY KEY,
  gmail_history_id text,
  reviewed_message_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  recent_emails_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  initialized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
