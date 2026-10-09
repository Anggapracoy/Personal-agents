-- WhatsApp identities are provisioned out of band after the owner has
-- authenticated in Dash. An inbound number must never select an owner by
-- itself.
CREATE TABLE IF NOT EXISTS whatsapp_identities (
  phone_number_id text NOT NULL,
  wa_id text NOT NULL,
  owner_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone_number_id, wa_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_identities_owner_idx
  ON whatsapp_identities(owner_email);

CREATE TABLE IF NOT EXISTS whatsapp_inbound_events (
  provider_message_id text PRIMARY KEY,
  phone_number_id text NOT NULL,
  wa_id text NOT NULL,
  owner_email text,
  body text NOT NULL,
  received_at timestamptz NOT NULL,
  run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_inbound_events_owner_idx
  ON whatsapp_inbound_events(owner_email, created_at DESC);
