CREATE TABLE IF NOT EXISTS connected_icloud_mail_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_email text NOT NULL,
 email text NOT NULL,
 encrypted_password text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 reconnect_required_at timestamptz,
 last_checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_email,email)
);
CREATE INDEX IF NOT EXISTS icloud_mail_due_idx ON connected_icloud_mail_accounts(last_checked_at) WHERE enabled=true AND reconnect_required_at IS NULL;
