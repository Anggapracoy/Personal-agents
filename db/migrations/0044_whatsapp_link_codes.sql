CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
  code_hash text PRIMARY KEY,
  owner_email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_link_codes_expiry_idx
  ON whatsapp_link_codes(expires_at) WHERE used_at IS NULL;
