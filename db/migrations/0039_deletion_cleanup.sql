-- Local deletion commits independently of provider availability. The encrypted
-- outbox contains only credentials/identifiers needed to finish disconnection.
CREATE TABLE IF NOT EXISTS account_deletion_jobs (
  owner_email text PRIMARY KEY,
  encrypted_payload text NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
