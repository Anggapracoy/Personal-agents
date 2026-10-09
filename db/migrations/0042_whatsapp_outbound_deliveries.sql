CREATE TABLE IF NOT EXISTS whatsapp_outbound_deliveries (
  delivery_key text PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  to_wa_id text NOT NULL,
  phone_number_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS whatsapp_outbound_deliveries_run_idx
  ON whatsapp_outbound_deliveries(run_id, created_at DESC);
