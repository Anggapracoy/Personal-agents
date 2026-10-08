CREATE TABLE IF NOT EXISTS shared_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  source_app text NOT NULL DEFAULT 'manual',
  text_content text NOT NULL DEFAULT '',
  source_url text,
  files_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_intakes_owner_created_idx
  ON shared_intakes (owner_email, created_at DESC);

CREATE TABLE IF NOT EXISTS consumer_vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('login', 'payment_card')),
  label text NOT NULL,
  site_host text,
  username_hint text,
  card_brand text,
  card_last4 text,
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consumer_vault_items_owner_kind_idx
  ON consumer_vault_items (owner_email, kind);
CREATE INDEX IF NOT EXISTS consumer_vault_items_owner_host_idx
  ON consumer_vault_items (owner_email, site_host);
