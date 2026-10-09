ALTER TABLE whatsapp_identities
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS whatsapp_identities_run_idx ON whatsapp_identities(run_id);
