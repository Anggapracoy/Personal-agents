CREATE TABLE IF NOT EXISTS connected_google_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  google_subject text NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  scopes text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connected_google_accounts_owner_subject_uidx
  ON connected_google_accounts (owner_email, google_subject);
CREATE UNIQUE INDEX IF NOT EXISTS connected_google_accounts_owner_email_uidx
  ON connected_google_accounts (owner_email, email);
CREATE INDEX IF NOT EXISTS connected_google_accounts_owner_idx
  ON connected_google_accounts (owner_email, enabled);
