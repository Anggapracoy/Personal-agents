-- Credential payloads now live only in the user's iOS Keychain. This project
-- replays SQL files rather than using a migration ledger, so record this one
-- destructive conversion explicitly and never purge newly-created metadata on
-- a later deploy.
CREATE TABLE IF NOT EXISTS app_schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_schema_migrations WHERE name = '0013_local_device_vault') THEN
    DELETE FROM consumer_vault_items;
    ALTER TABLE consumer_vault_items ALTER COLUMN encrypted_payload DROP NOT NULL;
    INSERT INTO app_schema_migrations (name) VALUES ('0013_local_device_vault');
  END IF;
END $$;
