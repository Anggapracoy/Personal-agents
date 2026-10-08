CREATE TABLE IF NOT EXISTS waitlist_entries (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_email_normalized CHECK (email = lower(btrim(email)))
);
CREATE INDEX IF NOT EXISTS waitlist_entries_created_at_idx ON waitlist_entries (created_at DESC);
