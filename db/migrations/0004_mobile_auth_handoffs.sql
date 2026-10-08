CREATE TABLE IF NOT EXISTS mobile_auth_handoffs (
  code_hash text PRIMARY KEY,
  encrypted_session_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobile_auth_handoffs_expiry_idx
  ON mobile_auth_handoffs (expires_at);
